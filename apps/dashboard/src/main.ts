import { bootstrapApplication } from '@angular/platform-browser';
import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import 'zone.js';

interface Route {
  id: number;
  tenant_id: string;
  host: string;
  upstream_service: string;
  upstream_port: number;
}

interface ClusterHealth {
  name: string;
  tenant_id: string;
  status: string;
  healthy_pods: number;
  total_pods: number;
  pod_ips: string[];
}

interface SystemStatus {
  control_plane: {
    version: number;
    last_pushed_at: string;
    last_push_duration_ms: number;
    connected_proxies: number;
    proxy_nodes: string[];
  };
  clusters: ClusterHealth[];
}

interface Toast {
  id: number;
  message: string;
  type: 'success' | 'error' | 'info';
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule],
  styleUrl: './app/app.component.css',
  template: `
    <div class="shell">
      <nav class="navbar">
        <div class="brand">
          <div class="brand-icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
            </svg>
          </div>
          <span class="brand-title">KubeIngress</span>
          <span class="version-tag">v1.3</span>
        </div>

        <div class="status-pill" [class.online]="backendOnline" [class.offline]="!backendOnline">
          <span class="dot"></span>
          <span>{{ backendOnline ? 'Control Plane Online' : 'Backend Disconnected' }}</span>
        </div>
      </nav>

      <main class="content">
        <div *ngIf="!backendOnline" class="alert-banner">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          Cannot connect to Control Plane REST API on :8080.
        </div>

        <section class="stats-grid">
          <div class="stat-card">
            <span class="stat-title">Active Proxies</span>
            <div class="stat-value">
              <span class="stat-number">{{ systemStatus?.control_plane?.connected_proxies || 0 }}</span>
              <span class="stat-badge" [class.badge-green]="(systemStatus?.control_plane?.connected_proxies || 0) > 0">
                {{ (systemStatus?.control_plane?.connected_proxies || 0) > 0 ? 'Connected' : 'None' }}
              </span>
            </div>
            <span class="stat-sub font-mono">{{ systemStatus?.control_plane?.proxy_nodes?.join(', ') || 'No nodes' }}</span>
          </div>

          <div class="stat-card">
            <span class="stat-title">xDS Snapshot</span>
            <div class="stat-value">
              <span class="stat-number font-mono">v{{ systemStatus?.control_plane?.version || 1 }}</span>
              <span class="stat-badge badge-blue">ADS Synced</span>
            </div>
            <span class="stat-sub">Dynamic in-memory cache</span>
          </div>

          <div class="stat-card">
            <span class="stat-title">Push Latency</span>
            <div class="stat-value">
              <span class="stat-number font-mono">{{ systemStatus?.control_plane?.last_push_duration_ms || 0 }}</span>
              <span class="stat-unit">ms</span>
            </div>
            <span class="stat-sub">Protobuf translation duration</span>
          </div>

          <div class="stat-card">
            <span class="stat-title">Last Synced</span>
            <div class="stat-value">
              <span class="stat-time">{{ formatTime(systemStatus?.control_plane?.last_pushed_at) }}</span>
            </div>
            <span class="stat-sub font-mono">{{ systemStatus?.control_plane?.last_pushed_at ? (systemStatus?.control_plane?.last_pushed_at | date:'HH:mm:ss UTC') : 'Pending' }}</span>
          </div>
        </section>

        <section class="card form-card">
          <div class="card-header">
            <h3>Publish Dynamic Ingress Route</h3>
            <p>Routes will be pushed to the Envoy fleet over gRPC with zero downtime.</p>
          </div>

          <form (ngSubmit)="addRoute()" class="route-form">
            <div class="form-group">
              <label>Tenant Identifier</label>
              <input [(ngModel)]="newRoute.tenant_id" name="tenant_id" placeholder="e.g. analytics" required />
            </div>

            <div class="form-group">
              <label>Public Domain / Host</label>
              <input [(ngModel)]="newRoute.host" name="host" placeholder="e.g. analytics.local" required />
            </div>

            <div class="form-group grow">
              <label>Upstream Kubernetes Service</label>
              <input [(ngModel)]="newRoute.upstream_service" name="upstream_service" placeholder="service.namespace.svc.cluster.local" required />
            </div>

            <div class="form-group port-group">
              <label>Port</label>
              <input [(ngModel)]="newRoute.upstream_port" name="upstream_port" type="number" placeholder="80" required />
            </div>

            <button type="submit" class="btn-primary" [disabled]="isSubmitting || !backendOnline">
              <span>{{ isSubmitting ? 'Syncing...' : '+ Add Route' }}</span>
            </button>
          </form>
        </section>

        <section class="card table-card">
          <div class="card-header table-header">
            <div>
              <h3>Active Ingress Rules</h3>
              <p>Live routes currently mapped inside Envoy's dynamic routing table.</p>
            </div>
            <div class="badge-count">{{ routes.length }} Active {{ routes.length === 1 ? 'Route' : 'Routes' }}</div>
          </div>

          <div class="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Tenant</th>
                  <th>Public Host</th>
                  <th>Upstream Target</th>
                  <th>Pod Health</th>
                  <th class="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                <tr *ngFor="let r of routes" class="route-row">
                  <td class="col-id">#{{ r.id }}</td>
                  <td><span class="tenant-badge">{{ r.tenant_id }}</span></td>
                  <td class="col-host"><span class="host-text">{{ r.host }}</span></td>
                  <td class="col-target font-mono">
                    {{ r.upstream_service }}<span class="port-num">:{{ r.upstream_port }}</span>
                  </td>
                  <td>
                    <span class="health-pill" [class]="getClusterHealth(r.tenant_id).class" [title]="getClusterHealth(r.tenant_id).tooltip">
                      <span class="health-dot"></span>
                      {{ getClusterHealth(r.tenant_id).text }}
                    </span>
                  </td>
                  <td class="text-right">
                    <button class="btn-delete" (click)="deleteRoute(r.id, r.host)" title="Remove route">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                      </svg>
                      Delete
                    </button>
                  </td>
                </tr>

                <tr *ngIf="routes.length === 0 && !isLoading">
                  <td colspan="6" class="empty-state">
                    <div class="empty-box">
                      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                        <rect x="2" y="2" width="20" height="8" rx="2" ry="2"/><rect x="2" y="14" width="20" height="8" rx="2" ry="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/>
                      </svg>
                      <p>No ingress routes registered.</p>
                      <span>Add a dynamic route above to sync Envoy's routing table.</span>
                    </div>
                  </td>
                </tr>

                <tr *ngIf="isLoading">
                  <td colspan="6" class="loading-state">
                    <span class="spinner"></span> Syncing with PostgreSQL...
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </main>

      <div class="toast-container">
        <div *ngFor="let t of toasts" class="toast" [class]="t.type">
          <span class="toast-indicator"></span>
          <span>{{ t.message }}</span>
        </div>
      </div>
    </div>
  `
})
export class App implements OnInit, OnDestroy {
  routes: Route[] = [];
  systemStatus: SystemStatus | null = null;
  backendOnline = false;
  isLoading = true;
  isSubmitting = false;
  toasts: Toast[] = [];

  newRoute = {
    tenant_id: '',
    host: '',
    upstream_service: '',
    upstream_port: 80
  };

  private pollTimer: any;

  ngOnInit() {
    this.refresh();
    this.pollTimer = setInterval(() => this.refresh(false), 3000);
  }

  ngOnDestroy() {
    if (this.pollTimer) clearInterval(this.pollTimer);
  }

  refresh(showLoading = true) {
    if (showLoading) this.isLoading = true;

    fetch('/api/routes')
      .then(res => {
        if (!res.ok) throw new Error();
        return res.json();
      })
      .then(data => {
        this.routes = data || [];
        this.backendOnline = true;
        this.isLoading = false;
      })
      .catch(() => {
        this.backendOnline = false;
        this.isLoading = false;
      });

    fetch('/api/status')
      .then(res => res.json())
      .then(data => {
        this.systemStatus = data;
      })
      .catch(() => {});
  }

  getClusterHealth(tenantId: string) {
    if (!this.systemStatus?.clusters) {
      return { class: 'health-unknown', text: 'Unknown', tooltip: 'No telemetry' };
    }
    const cluster = this.systemStatus.clusters.find(c => c.tenant_id === tenantId);
    if (!cluster) {
      return { class: 'health-unknown', text: 'Pending xDS', tooltip: 'Waiting for discovery' };
    }
    if (cluster.status === 'HEALTHY') {
      return {
        class: 'health-ok',
        text: `${cluster.healthy_pods}/${cluster.total_pods} Healthy`,
        tooltip: cluster.pod_ips.join(', ')
      };
    }
    return {
      class: 'health-bad',
      text: `${cluster.healthy_pods}/${cluster.total_pods} Unhealthy`,
      tooltip: cluster.pod_ips.join(', ') || 'No endpoints'
    };
  }

  formatTime(isoString?: string) {
    if (!isoString) return 'Never';
    const diff = Math.floor((Date.now() - new Date(isoString).getTime()) / 1000);
    if (diff < 5) return 'Just now';
    if (diff < 60) return `${diff}s ago`;
    return `${Math.floor(diff / 60)}m ago`;
  }

  addRoute() {
    if (!this.newRoute.tenant_id || !this.newRoute.host || !this.newRoute.upstream_service) {
      this.toast('Please fill all required fields.', 'error');
      return;
    }

    this.isSubmitting = true;

    fetch('/api/routes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(this.newRoute)
    })
      .then(res => {
        if (!res.ok) throw new Error('Failed to create route');
        this.toast(`Route for "${this.newRoute.host}" published to Envoy!`, 'success');
        this.newRoute = { tenant_id: '', host: '', upstream_service: '', upstream_port: 80 };
        this.refresh(false);
      })
      .catch(err => {
        this.toast(err.message, 'error');
      })
      .finally(() => {
        this.isSubmitting = false;
      });
  }

  deleteRoute(id: number, host: string) {
    fetch(`/api/routes?id=${id}`, { method: 'DELETE' })
      .then(res => {
        if (!res.ok) throw new Error('Failed to delete route');
        this.toast(`Route "${host}" deleted from Envoy.`, 'info');
        this.refresh(false);
      })
      .catch(err => {
        this.toast(err.message, 'error');
      });
  }

  toast(message: string, type: 'success' | 'error' | 'info') {
    const id = Date.now();
    this.toasts.push({ id, message, type });
    setTimeout(() => {
      this.toasts = this.toasts.filter(t => t.id !== id);
    }, 4000);
  }
}

bootstrapApplication(App);
