package api

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/adimail/KubeIngress/control-plane/internal/db"
	"github.com/adimail/KubeIngress/control-plane/internal/server"
)

type ClusterHealth struct {
	Name        string   `json:"name"`
	TenantID    string   `json:"tenant_id"`
	Status      string   `json:"status"`
	HealthyPods int      `json:"healthy_pods"`
	TotalPods   int      `json:"total_pods"`
	PodIPs      []string `json:"pod_ips"`
}

type SystemStatusResponse struct {
	ControlPlane server.Telemetry `json:"control_plane"`
	Clusters     []ClusterHealth  `json:"clusters"`
}

type Server struct {
	dbClient   *db.Client
	xdsServer  *server.ControlPlane
	httpServer *http.Server
	client     *http.Client
	envoyAdmin string
}

func NewServer(port int, dbClient *db.Client, xdsServer *server.ControlPlane) *Server {
	s := &Server{
		dbClient:  dbClient,
		xdsServer: xdsServer,
		client:    &http.Client{Timeout: 2 * time.Second},
	}

	envoyHost := os.Getenv("ENVOY_ADMIN_URL")
	if envoyHost == "" {
		envoyHost = "http://envoy.kubeingress-system.svc.cluster.local:9901"
	}
	s.envoyAdmin = envoyHost

	mux := http.NewServeMux()
	mux.HandleFunc("/api/routes", s.handleRoutes)
	mux.HandleFunc("/api/status", s.handleStatus)

	s.httpServer = &http.Server{
		Addr:    fmt.Sprintf(":%d", port),
		Handler: s.corsMiddleware(mux),
	}

	return s
}

func (s *Server) Start() error {
	log.Printf("Control Plane REST API listening on %s...", s.httpServer.Addr)
	if err := s.httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		return err
	}
	return nil
}

func (s *Server) Shutdown(ctx context.Context) error {
	return s.httpServer.Shutdown(ctx)
}

func (s *Server) handleStatus(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	w.Header().Set("Content-Type", "application/json")

	telemetry := s.xdsServer.GetTelemetry()
	clusters := s.fetchEnvoyClusters()

	resp := SystemStatusResponse{
		ControlPlane: telemetry,
		Clusters:     clusters,
	}

	json.NewEncoder(w).Encode(resp)
}

func (s *Server) fetchEnvoyClusters() []ClusterHealth {
	var results []ClusterHealth

	resp, err := s.client.Get(fmt.Sprintf("%s/clusters?format=json", s.envoyAdmin))
	if err != nil {
		return results
	}
	defer resp.Body.Close()

	var data struct {
		ClusterStatuses []struct {
			Name         string `json:"name"`
			HostStatuses []struct {
				Address struct {
					SocketAddress struct {
						Address   string `json:"address"`
						PortValue int    `json:"port_value"`
					} `json:"socket_address"`
				} `json:"address"`
				HealthStatus struct {
					EdsHealthStatus string `json:"eds_health_status"`
				} `json:"health_status"`
			} `json:"host_statuses"`
		} `json:"cluster_statuses"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		return results
	}

	for _, cs := range data.ClusterStatuses {
		if cs.Name == "xds_cluster" {
			continue
		}

		tenantID := strings.TrimSuffix(cs.Name, "_cluster")
		healthy := 0
		total := len(cs.HostStatuses)
		var ips []string

		for _, h := range cs.HostStatuses {
			endpoint := fmt.Sprintf("%s:%d", h.Address.SocketAddress.Address, h.Address.SocketAddress.PortValue)
			ips = append(ips, endpoint)
			if h.HealthStatus.EdsHealthStatus == "HEALTHY" || h.HealthStatus.EdsHealthStatus == "" {
				healthy++
			}
		}

		status := "HEALTHY"
		if total == 0 || healthy == 0 {
			status = "UNHEALTHY"
		} else if healthy < total {
			status = "DEGRADED"
		}

		results = append(results, ClusterHealth{
			Name:        cs.Name,
			TenantID:    tenantID,
			Status:      status,
			HealthyPods: healthy,
			TotalPods:   total,
			PodIPs:      ips,
		})
	}

	return results
}

func (s *Server) handleRoutes(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	switch r.Method {
	case http.MethodGet:
		routes, err := s.dbClient.GetRoutes(r.Context())
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		json.NewEncoder(w).Encode(routes)

	case http.MethodPost:
		var route db.Route
		if err := json.NewDecoder(r.Body).Decode(&route); err != nil {
			http.Error(w, "Invalid request body", http.StatusBadRequest)
			return
		}
		if err := s.dbClient.CreateRoute(r.Context(), route); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusCreated)

	case http.MethodDelete:
		idStr := r.URL.Query().Get("id")
		id, err := strconv.Atoi(idStr)
		if err != nil {
			http.Error(w, "Invalid id parameter", http.StatusBadRequest)
			return
		}
		if err := s.dbClient.DeleteRoute(r.Context(), id); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusNoContent)

	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

func (s *Server) corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")

		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusOK)
			return
		}

		next.ServeHTTP(w, r)
	})
}
