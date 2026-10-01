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
