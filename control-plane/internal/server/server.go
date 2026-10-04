package server

import (
	"context"
	"fmt"
	"log"
	"net"
	"sync"
	"time"

	clusterservice "github.com/envoyproxy/go-control-plane/envoy/service/cluster/v3"
	discoverygrpc "github.com/envoyproxy/go-control-plane/envoy/service/discovery/v3"
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

type ControlPlane struct {
	dbClient   *db.Client
	cache      cache.SnapshotCache
	version    int64
	synced     bool       // Tracks if initial sync occurred
	lastRoutes []db.Route // Cache to detect real changes
	mu         sync.Mutex
}

func New(dbClient *db.Client) *ControlPlane {
	return &ControlPlane{
		dbClient: dbClient,
		cache:    cache.NewSnapshotCache(false, cache.IDHash{}, nil),
		version:  1,
	}
}

func (cp *ControlPlane) Start(ctx context.Context, port int) error {
	// 1. Initial snapshot sync
	if err := cp.reconcile(ctx); err != nil {
		log.Printf("Initial sync failed: %v", err)
	}

	// 2. Start background DB watcher
	go cp.watchDB(ctx)

	// 3. Start gRPC xDS Server
	srv := serverv3.NewServer(ctx, cp.cache, nil)
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

	// If we already synced once and routes haven't changed, do nothing!
	if cp.synced && routesEqual(cp.lastRoutes, routes) {
		return nil
	}

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

	cp.synced = true
	cp.lastRoutes = routes
	log.Printf("Updated xDS snapshot (version %s) with %d routes", versionStr, len(routes))
	return nil
}

// routesEqual checks if two route lists are identical
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
