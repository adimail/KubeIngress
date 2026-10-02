# KubeIngress
Cloud-Native Enterprise Ingress & Dynamic Control Plane

KubeIngress is a cloud-native, multi-tenant ingress platform built with Envoy and Go, providing dynamic xDS-based service routing, edge authentication, distributed rate limiting, and zero-downtime configuration updates across Kubernetes workloads. The platform is designed around a custom control plane that continuously manages routing and security policies for a fleet of Envoy data-plane proxies.


```
[ Internet Traffic ]
        │
        ▼
┌────────────────────────────────────────────────────────────────┐
│ 1. DATA PLANE (Envoy Proxy Fleet in Kubernetes)                │
│    - Terminates TLS / SSL (HTTPS)                              │
│    - Validates JWT tokens at the edge                          │
│    - Checks Redis for Rate Limits (e.g., 100 req/min/tenant)   │
│    - Routes: acme.domain.com -> Acme Pods                      │
│              stark.domain.com -> Stark Pods                    │
└───────────────▲────────────────────────────────────────────────┘
                │ Streams dynamic routes via gRPC (xDS API)
                │ (Zero downtime, no proxy restarts)
┌───────────────┴────────────────────────────────────────────────┐
│ 2. CONTROL PLANE (Your Custom Go or Python Service)            │
│    - Watches PostgreSQL for new tenants or routing rules       │
│    - Translates database configs into Envoy-compatible xDS      │
│    - Pushes live updates to the Data Plane instantly           │
└───────────────▲────────────────────────────────────────────────┘
                │
┌───────────────┴────────────────────────────────────────────────┐
│ 3. CLOUD & PLATFORM FOUNDATION (Terraform + Kubernetes)        │
│    - AWS/GCP: VPCs, Subnets, Network Load Balancers (NLB)      │
│    - Data: Redis (Rate limiting), Postgres (Tenant metadata)   │
│    - Observability: Prometheus/Datadog metrics, p99 latencies  │
└────────────────────────────────────────────────────────────────┘
```

Here is a minimal, command-focused `README.md` for Phase 1:

## Phase 1: Local Cluster & Tenant Workloads

### 1. Create Cluster
```bash
kind create cluster --name kubeingress --config deploy/kind/kind-cluster.yaml
```

### 2. Build & Sideload Images
```bash
# Build
docker build -t gallery:v1 ./apps/gallery
docker build -t enigma:v1 ./apps/enigma

# Load into Kind
kind load docker-image gallery:v1 --name kubeingress
kind load docker-image enigma:v1 --name kubeingress
```

### 3. Deploy Tenants
```bash
# Gallery
kubectl apply -f deploy/tenants/gallery/namespace.yaml
kubectl apply -f deploy/tenants/gallery/

# Enigma
kubectl apply -f deploy/tenants/enigma/namespace.yaml
kubectl apply -f deploy/tenants/enigma/
```

### 4. Verify Workloads
```bash
# Check status
kubectl get pods -n gallery
kubectl get pods -n enigma

# Test Gallery (HTML + Pod Identity)
kubectl run test-pod --rm -it --image=curlimages/curl --restart=Never -- \
  curl -s http://gallery-service.gallery.svc.cluster.local | grep -A 3 "identity-badge"

# Test Enigma (POST Hash API)
kubectl run test-pod --rm -it --image=curlimages/curl --restart=Never -- \
  curl -s -X POST http://enigma-service.enigma.svc.cluster.local \
  -H "Content-Type: application/json" \
  -d '{"input": "kubeingress"}'
```
