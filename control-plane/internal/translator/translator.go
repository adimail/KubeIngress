package translator

import (
	"fmt"
	"time"

	cluster "github.com/envoyproxy/go-control-plane/envoy/config/cluster/v3"
	core "github.com/envoyproxy/go-control-plane/envoy/config/core/v3"
	endpoint "github.com/envoyproxy/go-control-plane/envoy/config/endpoint/v3"
	listener "github.com/envoyproxy/go-control-plane/envoy/config/listener/v3"
	route "github.com/envoyproxy/go-control-plane/envoy/config/route/v3"
	router "github.com/envoyproxy/go-control-plane/envoy/extensions/filters/http/router/v3"
	hcm "github.com/envoyproxy/go-control-plane/envoy/extensions/filters/network/http_connection_manager/v3"
	"github.com/envoyproxy/go-control-plane/pkg/cache/types"
	cache "github.com/envoyproxy/go-control-plane/pkg/cache/v3"
	"github.com/envoyproxy/go-control-plane/pkg/resource/v3"
	"google.golang.org/protobuf/types/known/anypb"
	"google.golang.org/protobuf/types/known/durationpb"

	"github.com/adimail/KubeIngress/control-plane/internal/db"
)

func BuildSnapshot(version string, routes []db.Route) (*cache.Snapshot, error) {
	var clusters []types.Resource
	var virtualHosts []*route.VirtualHost

	for _, r := range routes {
		clusterName := fmt.Sprintf("%s_cluster", r.TenantID)

		// 1. Create Envoy Upstream Cluster (CDS)
		clusters = append(clusters, makeCluster(clusterName, r.UpstreamService, uint32(r.UpstreamPort)))

		// 2. Create Virtual Host Route (RDS)
		virtualHosts = append(virtualHosts, &route.VirtualHost{
			Name:    fmt.Sprintf("%s_vhost", r.TenantID),
			Domains: []string{r.Host, fmt.Sprintf("%s:*", r.Host)},
			Routes: []*route.Route{
				{
					Match: &route.RouteMatch{
						PathSpecifier: &route.RouteMatch_Prefix{Prefix: "/"},
					},
					Action: &route.Route_Route{
						Route: &route.RouteAction{
							ClusterSpecifier: &route.RouteAction_Cluster{Cluster: clusterName},
						},
					},
				},
			},
		})
	}

	// 3. Create HTTP Listener on port 10000 (LDS)
	lis, err := makeListener("ingress_listener", 10000, virtualHosts)
	if err != nil {
		return nil, fmt.Errorf("failed to create listener: %w", err)
	}

	// 4. Compile into an xDS Snapshot
	snapshot, err := cache.NewSnapshot(version, map[resource.Type][]types.Resource{
		resource.ClusterType:  clusters,
		resource.ListenerType: {lis},
	})
	if err != nil {
		return nil, fmt.Errorf("failed to generate snapshot: %w", err)
	}

	return snapshot, nil
}

func makeCluster(name, serviceAddress string, port uint32) *cluster.Cluster {
	return &cluster.Cluster{
		Name:                 name,
		ConnectTimeout:       durationpb.New(2 * time.Second),
		ClusterDiscoveryType: &cluster.Cluster_Type{Type: cluster.Cluster_STRICT_DNS},
		DnsLookupFamily:      cluster.Cluster_V4_ONLY,
		LbPolicy:             cluster.Cluster_ROUND_ROBIN,
		LoadAssignment: &endpoint.ClusterLoadAssignment{
			ClusterName: name,
			Endpoints: []*endpoint.LocalityLbEndpoints{
				{
					LbEndpoints: []*endpoint.LbEndpoint{
						{
							HostIdentifier: &endpoint.LbEndpoint_Endpoint{
								Endpoint: &endpoint.Endpoint{
									Address: &core.Address{
										Address: &core.Address_SocketAddress{
											SocketAddress: &core.SocketAddress{
												Address:       serviceAddress,
												PortSpecifier: &core.SocketAddress_PortValue{PortValue: port},
											},
										},
									},
								},
							},
						},
					},
				},
			},
		},
	}
}

func makeListener(name string, port uint32, virtualHosts []*route.VirtualHost) (*listener.Listener, error) {
	routerConfig, err := anypb.New(&router.Router{})
	if err != nil {
		return nil, err
	}

	manager := &hcm.HttpConnectionManager{
		StatPrefix: "ingress_http",
		RouteSpecifier: &hcm.HttpConnectionManager_RouteConfig{
			RouteConfig: &route.RouteConfiguration{
				Name:         "dynamic_routes",
				VirtualHosts: virtualHosts,
			},
		},
		HttpFilters: []*hcm.HttpFilter{
			{
				Name:       "envoy.filters.http.router",
				ConfigType: &hcm.HttpFilter_TypedConfig{TypedConfig: routerConfig},
			},
		},
	}

	pbst, err := anypb.New(manager)
	if err != nil {
		return nil, err
	}

	return &listener.Listener{
		Name: name,
		Address: &core.Address{
			Address: &core.Address_SocketAddress{
				SocketAddress: &core.SocketAddress{
					Address:       "0.0.0.0",
					PortSpecifier: &core.SocketAddress_PortValue{PortValue: port},
				},
			},
		},
		FilterChains: []*listener.FilterChain{
			{
				Filters: []*listener.Filter{
					{
						Name:       "envoy.filters.network.http_connection_manager",
						ConfigType: &listener.Filter_TypedConfig{TypedConfig: pbst},
					},
				},
			},
		},
	}, nil
}
