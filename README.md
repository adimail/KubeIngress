# KubeIngress

A cloud-native dynamic ingress controller and control plane for Kubernetes, built with Envoy, Go, PostgreSQL, and Angular.

---

## The Story Behind This Project

I wanted to learn Kubernetes deeply by building something that engineering teams at top companies actually use.

The spark for this project came from a video by Vasilios Syrakis about him getting laid off by Atlassian. Listening to discussions about internal infrastructure, platform teams, and how companies at that scale manage traffic led me down a rabbit hole into how Atlassian solves ingress and routing.

That is where I learned about Atlassian Sovereign:
* Atlassian Sovereign is an open-source, lightweight control plane written for Envoy proxy. Instead of hardcoding proxy configuration files on disk, Sovereign speaks Envoy’s xDS protocol over the network to push routing changes dynamically on the fly.

---

## What Does KubeIngress Do?

In traditional setups (like classic NGINX Ingress), every time you add a new domain or change a routing rule:
1. You have to edit a configuration file on disk.
2. The proxy reloads its process (`nginx -s reload`).
3. At high traffic volumes, reloading drops active connections and causes micro-outages.

KubeIngress seperates the Data Plane from the Control Plane:

* Envoy (The Data Plane): Sits at the edge of the Kubernetes cluster as the front door. It starts up with zero hardcoded routes.
* Go Control Plane: A custom Go service that watches a PostgreSQL database where tenant routes are stored.
* The gRPC Stream (xDS): Whenever a route is added or deleted in PostgreSQL, the Go service translates the database record into an Envoy Protobuf structure and streams it to Envoy over gRPC.
* Zero Downtime: Envoy updates its memory tables instantly. No files are written to disk, no processes are restarted, and zero packets are dropped.

---

## How It Works

```
[ Browser / Internet Traffic ]
              │
              ▼
┌────────────────────────────────────────────────────────┐
│ Envoy Proxy Fleet (Data Plane)                         │
│  - Listens on port 80                                  │
│  - Routes traffic directly to backend Pods             │
└───────────────▲────────────────────────────────────────┘
                │ Streams dynamic routes via gRPC (xDS)
                │ (Zero downtime, zero proxy restarts)
┌───────────────┴────────────────────────────────────────┐
│ Go Control Plane                                       │
│  - Watches PostgreSQL for routing changes              │
│  - Serves xDS on port 18000                            │
│  - Exposes REST API on port 8080 for route management  │
└───────▲────────────────────────────────────────┬───────┘
        │ Reads / Writes                         │ Reverse-proxied
        ▼                                        ▼
┌──────────────────────────┐         ┌──────────────────────────┐
│ PostgreSQL Database      │         │ Angular Web Console      │
│  - Stores tenant domains │         │  - Real-time telemetry   │
│  - Auto-migrated on boot │         │  - Live pod health       │
└──────────────────────────┘         └──────────────────────────┘
```

1. The Web Dashboard (`dashboard.local`):
   A minimal Angular console where an operator can add or delete routing rules. It also displays live telemetry: connected Envoy nodes, xDS push latency, and real-time pod health (`2/2 Healthy`). The dashboard is "dogfooded"—it runs inside Kubernetes and is routed through Envoy itself.

2. The Backend Workloads:
   To prove multi-tenancy, the cluster hosts two distinct applications:
   * `gallery.local`: An interactive image viewer that reads Kubernetes metadata using the Downward API to visually show requests load-balancing across pod replicas.
   * `enigma.local`: A compute-heavy SHA-256 hashing and animal fingerprint API.

3. Direct-to-Pod Networking (Headless Services):
   Rather than routing through standard Kubernetes virtual IPs (`ClusterIP`), services are configured as Headless (`clusterIP: None`). This allows Envoy's DNS resolver to discover the actual underlying Pod IPs directly, enabling smart client-side load balancing and accurate pod health reporting.

---

## What I Learned Building This

* Kubernetes Networking Primitives: The difference between Virtual ClusterIPs, Headless Services, CoreDNS record resolution, and `hostPort` container bindings.
* Envoy's xDS Architecture: How Listeners (LDS), Route Configurations (RDS), and Clusters (CDS) fit together in memory.
* Systems Programming in Go: Streaming state machines over gRPC using `go-control-plane`, implementing connection callbacks, and managing concurrency.
* Production Database Patterns: Running embedded, versioned SQL migrations using Go's `embed.FS` with PostgreSQL advisory locks instead of static initialization scripts.
* Full-Stack Orchestration: Bridging an Angular frontend, an NGINX reverse-proxy, a Go backend, a PostgreSQL datastore, and an Envoy data plane into a cohesive system.
