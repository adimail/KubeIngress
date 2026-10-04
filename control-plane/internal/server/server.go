package server

import (
	"context"
	"fmt"
	"log"
	"net"
	"sync"
	"time"

	corev3 "github.com/envoyproxy/go-control-plane/envoy/config/core/v3"
	clusterservice "github.com/envoyproxy/go-control-plane/envoy/service/cluster/v3"
	discoverygrpc "github.com/envoyproxy/go-control-plane/envoy/service/discovery/v3"
	discoveryv3 "github.com/envoyproxy/go-control-plane/envoy/service/discovery/v3"
	endpointservice "github.com/envoyproxy/go-control-plane/envoy/service/endpoint/v3"
	listenerservice "github.com/envoyproxy/go-control-plane/envoy/service/listener/v3"
	routeservice "github.com/envoyproxy/go-control-plane/envoy/service/route/v3"
	"github.com/envoyproxy/go-control-plane/pkg/cache/v3"
	serverv3 "github.com/envoyproxy/go-control-plane/pkg/server/v3"
	"google.golang.org/grpc"

	"github.com/adimail/KubeIngress/control-plane/internal/db"
	"github.com/adimail/KubeIngress/control-plane/internal/translator"
)

const NodeID = "edge-proxy-1"

type Telemetry struct {
	Version            int64     `json:"version"`
	LastPushedAt       time.Time `json:"last_pushed_at"`
	LastPushDurationMs float64   `json:"last_push_duration_ms"`
	ConnectedProxies   int       `json:"connected_proxies"`
	ProxyNodes         []string  `json:"proxy_nodes"`
}

type ControlPlane struct {
	dbClient           *db.Client
	cache              cache.SnapshotCache
	version            int64
	synced             bool
	lastRoutes         []db.Route
	lastPushedAt       time.Time
	lastPushDurationMs float64
	connectedNodes     map[int64]string
	mu                 sync.RWMutex
}

func New(dbClient *db.Client) *ControlPlane {
	return &ControlPlane{
		dbClient:       dbClient,
		cache:          cache.NewSnapshotCache(false, cache.IDHash{}, nil),
		version:        1,
		connectedNodes: make(map[int64]string),
	}
}

func (cp *ControlPlane) Start(ctx context.Context, port int) error {
	if err := cp.reconcile(ctx); err != nil {
		log.Printf("Initial sync failed: %v", err)
	}

	go cp.watchDB(ctx)

	cb := &callbacks{cp: cp}
	srv := serverv3.NewServer(ctx, cp.cache, cb)
	grpcServer := grpc.NewServer()

	discoverygrpc.RegisterAggregatedDiscoveryServiceServer(grpcServer, srv)
	endpointservice.RegisterEndpointDiscoveryServiceServer(grpcServer, srv)
	clusterservice.RegisterClusterDiscoveryServiceServer(grpcServer, srv)
	routeservice.RegisterRouteDiscoveryServiceServer(grpcServer, srv)
	listenerservice.RegisterListenerDiscoveryServiceServer(grpcServer, srv)

	lis, err := net.Listen("tcp", fmt.Sprintf(":%d", port))
	if err != nil {
		return fmt.Errorf("failed to listen on port %d: %w", port, err)
	}

	log.Printf("Control Plane xDS gRPC server listening on port %d...", port)

	go func() {
		<-ctx.Done()
		grpcServer.GracefulStop()
	}()

	return grpcServer.Serve(lis)
}

func (cp *ControlPlane) watchDB(ctx context.Context) {
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if err := cp.reconcile(ctx); err != nil {
				log.Printf("Error reconciling routes: %v", err)
			}
		}
	}
}

func (cp *ControlPlane) reconcile(ctx context.Context) error {
	routes, err := cp.dbClient.GetRoutes(ctx)
	if err != nil {
		return err
	}

	cp.mu.Lock()
	defer cp.mu.Unlock()

	if cp.synced && routesEqual(cp.lastRoutes, routes) {
		return nil
	}

	start := time.Now()
	cp.version++
	versionStr := fmt.Sprintf("%d", cp.version)

	snap, err := translator.BuildSnapshot(versionStr, routes)
	if err != nil {
		return err
	}

	if err := snap.Consistent(); err != nil {
		return fmt.Errorf("snapshot inconsistent: %w", err)
	}

	if err := cp.cache.SetSnapshot(ctx, NodeID, snap); err != nil {
		return fmt.Errorf("failed to set snapshot: %w", err)
	}

	cp.lastPushDurationMs = float64(time.Since(start).Microseconds()) / 1000.0
	cp.lastPushedAt = time.Now().UTC()
	cp.synced = true
	cp.lastRoutes = routes

	log.Printf("Updated xDS snapshot (version %s) with %d routes", versionStr, len(routes))
	return nil
}

func (cp *ControlPlane) GetTelemetry() Telemetry {
	cp.mu.RLock()
	defer cp.mu.RUnlock()

	nodes := make([]string, 0, len(cp.connectedNodes))
	nodeSet := make(map[string]struct{})
	for _, id := range cp.connectedNodes {
		if id != "" {
			if _, exists := nodeSet[id]; !exists {
				nodeSet[id] = struct{}{}
				nodes = append(nodes, id)
			}
		}
	}

	return Telemetry{
		Version:            cp.version,
		LastPushedAt:       cp.lastPushedAt,
		LastPushDurationMs: cp.lastPushDurationMs,
		ConnectedProxies:   len(nodes),
		ProxyNodes:         nodes,
	}
}

func routesEqual(a, b []db.Route) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i].TenantID != b[i].TenantID ||
			a[i].Host != b[i].Host ||
			a[i].UpstreamService != b[i].UpstreamService ||
			a[i].UpstreamPort != b[i].UpstreamPort {
			return false
		}
	}
	return true
}

type callbacks struct {
	cp *ControlPlane
}

func (cb *callbacks) OnStreamOpen(_ context.Context, id int64, _ string) error {
	cb.cp.mu.Lock()
	cb.cp.connectedNodes[id] = ""
	cb.cp.mu.Unlock()
	return nil
}

func (cb *callbacks) OnStreamClosed(id int64, _ *corev3.Node) {
	cb.cp.mu.Lock()
	delete(cb.cp.connectedNodes, id)
	cb.cp.mu.Unlock()
}

func (cb *callbacks) OnStreamRequest(id int64, req *discoveryv3.DiscoveryRequest) error {
	if req.Node != nil && req.Node.Id != "" {
		cb.cp.mu.Lock()
		cb.cp.connectedNodes[id] = req.Node.Id
		cb.cp.mu.Unlock()
	}
	return nil
}

func (cb *callbacks) OnStreamResponse(_ context.Context, _ int64, _ *discoveryv3.DiscoveryRequest, _ *discoveryv3.DiscoveryResponse) {
}

func (cb *callbacks) OnFetchRequest(_ context.Context, _ *discoveryv3.DiscoveryRequest) error {
	return nil
}

func (cb *callbacks) OnFetchResponse(_ *discoveryv3.DiscoveryRequest, _ *discoveryv3.DiscoveryResponse) {
}

func (cb *callbacks) OnDeltaStreamClosed(_ int64, _ *corev3.Node)                  {}
func (cb *callbacks) OnDeltaStreamOpen(_ context.Context, _ int64, _ string) error { return nil }
func (cb *callbacks) OnStreamDeltaRequest(_ int64, _ *discoveryv3.DeltaDiscoveryRequest) error {
	return nil
}

func (cb *callbacks) OnStreamDeltaResponse(_ int64, _ *discoveryv3.DeltaDiscoveryRequest, _ *discoveryv3.DeltaDiscoveryResponse) {
}
