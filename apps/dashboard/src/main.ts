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

interface Toast {
  id: number;
  message: string;
  type: 'success' | 'error' | 'info';
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="shell">
      <!-- Top Navigation -->
      <nav class="navbar">
        <div class="brand">
          <span class="brand-title">KubeIngress</span>
        </div>

        <div class="status-pill" [class.online]="backendOnline" [class.offline]="!backendOnline">
          <span class="dot"></span>
          <span>{{ backendOnline ? 'Control Plane Online' : 'Backend Disconnected' }}</span>
        </div>
      </nav>

      <!-- Main Content -->
      <main class="content">
        <!-- Error Banner when backend is down -->
        <div *ngIf="!backendOnline" class="alert-banner">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          Cannot connect to Control Plane REST API on :8080. Check pod status or port-forwarding.
        </div>

        <!-- Add Route Section -->
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

        <!-- Routes Table Section -->
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
                  <th class="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                <tr *ngFor="let r of routes" class="route-row">
                  <td class="col-id">#{{ r.id }}</td>
                  <td><span class="tenant-badge">{{ r.tenant_id }}</span></td>
                  <td class="col-host">
                    <span class="host-text">{{ r.host }}</span>
                  </td>
                  <td class="col-target font-mono">
                    {{ r.upstream_service }}<span class="port-num">:{{ r.upstream_port }}</span>
                  </td>
                  <td class="text-right">
                    <button class="btn-delete" (click)="deleteRoute(r.id, r.host)" title="Remove from Envoy">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                      </svg>
                      Delete
                    </button>
                  </td>
                </tr>

                <!-- Empty State -->
                <tr *ngIf="routes.length === 0 && !isLoading">
                  <td colspan="5" class="empty-state">
                    <div class="empty-box">
                      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                        <rect x="2" y="2" width="20" height="8" rx="2" ry="2"/><rect x="2" y="14" width="20" height="8" rx="2" ry="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/>
                      </svg>
                      <p>No ingress routes registered.</p>
                      <span>Add a dynamic route above to sync Envoy's routing table.</span>
                    </div>
                  </td>
                </tr>

                <!-- Loading State -->
                <tr *ngIf="isLoading">
                  <td colspan="5" class="loading-state">
                    <span class="spinner"></span> Syncing with PostgreSQL...
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </main>

      <!-- Toast Notifications -->
      <div class="toast-container">
        <div *ngFor="let t of toasts" class="toast" [class]="t.type">
          <span class="toast-indicator"></span>
          <span>{{ t.message }}</span>
        </div>
      </div>
    </div>
  `,
  styles: [`
    :host {
      --bg: #09090b;
      --card-bg: #111116;
      --border: #22222a;
      --border-focus: #3b82f6;
      --text: #f4f4f5;
      --text-muted: #71717a;
      --primary: #2563eb;
      --primary-hover: #1d4ed8;
      --danger: #ef4444;
      --danger-bg: rgba(239, 68, 68, 0.1);
      --font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    }

    .shell {
      min-height: 100vh;
      background: var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    }

    /* Navbar */
    .navbar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 16px 32px;
      border-bottom: 1px solid var(--border);
      background: rgba(9, 9, 11, 0.8);
      backdrop-filter: blur(12px);
      position: sticky;
      top: 0;
      z-index: 10;
    }

    .brand {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .brand-icon {
      background: linear-gradient(135deg, #2563eb, #38bdf8);
      width: 28px;
      height: 28px;
      border-radius: 6px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: white;
    }

    .brand-title {
      font-weight: 700;
      font-size: 1.05rem;
      letter-spacing: -0.02em;
    }

    .version-tag {
      font-size: 0.7rem;
      background: #18181b;
      border: 1px solid var(--border);
      color: var(--text-muted);
      padding: 2px 6px;
      border-radius: 4px;
      font-family: var(--font-mono);
    }

    .status-pill {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 0.8rem;
      padding: 6px 14px;
      border-radius: 999px;
      font-weight: 500;
      border: 1px solid var(--border);
    }

    .status-pill .dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
    }

    .status-pill.online {
      background: rgba(16, 185, 129, 0.08);
      border-color: rgba(16, 185, 129, 0.2);
      color: #34d399;
    }
    .status-pill.online .dot {
      background: #10b981;
      box-shadow: 0 0 10px #10b981;
    }

    .status-pill.offline {
      background: rgba(239, 68, 68, 0.08);
      border-color: rgba(239, 68, 68, 0.2);
      color: #f87171;
    }
    .status-pill.offline .dot {
      background: #ef4444;
    }

    /* Content */
    .content {
      max-width: 1040px;
      margin: 36px auto;
      padding: 0 24px;
      display: flex;
      flex-direction: column;
      gap: 24px;
    }

    .alert-banner {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 12px 18px;
      background: rgba(239, 68, 68, 0.12);
      border: 1px solid rgba(239, 68, 68, 0.3);
      border-radius: 8px;
      color: #fca5a5;
      font-size: 0.85rem;
    }

    /* Cards */
    .card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 12px;
      overflow: hidden;
    }

    .card-header {
      padding: 20px 24px 16px;
    }

    .card-header h3 {
      margin: 0;
      font-size: 1rem;
      font-weight: 600;
      letter-spacing: -0.01em;
    }

    .card-header p {
      margin: 4px 0 0;
      font-size: 0.8rem;
      color: var(--text-muted);
    }

    /* Form */
    .route-form {
      padding: 0 24px 24px;
      display: flex;
      flex-wrap: wrap;
      align-items: flex-end;
      gap: 12px;
    }

    .form-group {
      display: flex;
      flex-direction: column;
      gap: 6px;
      flex: 1;
      min-width: 140px;
    }

    .form-group.grow {
      flex: 2;
      min-width: 220px;
    }

    .form-group.port-group {
      flex: 0 0 90px;
      min-width: 90px;
    }

    .form-group label {
      font-size: 0.72rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--text-muted);
    }

    input {
      background: #09090b;
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 9px 12px;
      font-size: 0.85rem;
      color: var(--text);
      outline: none;
      transition: all 0.15s ease;
      font-family: inherit;
    }

    input:focus {
      border-color: var(--border-focus);
      box-shadow: 0 0 0 1px var(--border-focus);
    }

    input::placeholder {
      color: #3f3f46;
    }

    .btn-primary {
      background: var(--primary);
      color: white;
      border: none;
      padding: 10px 18px;
      border-radius: 8px;
      font-size: 0.85rem;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.15s ease;
      height: 38px;
      white-space: nowrap;
    }

    .btn-primary:hover:not(:disabled) {
      background: var(--primary-hover);
    }

    .btn-primary:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    /* Table */
    .table-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 1px solid var(--border);
    }

    .badge-count {
      font-size: 0.75rem;
      background: #18181b;
      border: 1px solid var(--border);
      color: var(--text-muted);
      padding: 4px 10px;
      border-radius: 999px;
      font-family: var(--font-mono);
    }

    .table-wrapper {
      overflow-x: auto;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      text-align: left;
      font-size: 0.85rem;
    }

    th {
      padding: 12px 24px;
      color: var(--text-muted);
      font-size: 0.7rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      border-bottom: 1px solid var(--border);
      background: rgba(9, 9, 11, 0.4);
    }

    td {
      padding: 16px 24px;
      border-bottom: 1px solid #1a1a22;
      vertical-align: middle;
    }

    .route-row:hover td {
      background: rgba(255, 255, 255, 0.015);
    }

    .col-id {
      color: #52525b;
      font-family: var(--font-mono);
      font-size: 0.78rem;
    }

    .tenant-badge {
      background: #18181b;
      border: 1px solid var(--border);
      padding: 3px 8px;
      border-radius: 6px;
      font-size: 0.75rem;
      font-family: var(--font-mono);
      color: #a1a1aa;
    }

    .col-host .host-text {
      color: #38bdf8;
      font-weight: 600;
    }

    .col-target {
      color: #d4d4d8;
      font-size: 0.8rem;
    }

    .font-mono {
      font-family: var(--font-mono);
    }

    .port-num {
      color: #71717a;
    }

    .text-right {
      text-align: right;
    }

    .btn-delete {
      background: transparent;
      color: #f87171;
      border: 1px solid rgba(239, 68, 68, 0.2);
      padding: 6px 10px;
      border-radius: 6px;
      font-size: 0.75rem;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      transition: all 0.15s ease;
    }

    .btn-delete:hover {
      background: var(--danger-bg);
      border-color: var(--danger);
    }

    /* Empty & Loading States */
    .empty-state {
      padding: 48px 0;
      text-align: center;
    }

    .empty-box {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 6px;
      color: var(--text-muted);
    }

    .empty-box svg {
      stroke: #3f3f46;
      margin-bottom: 4px;
    }

    .empty-box p {
      margin: 0;
      font-weight: 500;
      color: var(--text);
    }

    .empty-box span {
      font-size: 0.8rem;
    }

    .loading-state {
      padding: 40px;
      text-align: center;
      color: var(--text-muted);
    }

    .spinner {
      display: inline-block;
      width: 14px;
      height: 14px;
      border: 2px solid #3f3f46;
      border-top-color: #38bdf8;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
      vertical-align: middle;
      margin-right: 6px;
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    /* Toasts */
    .toast-container {
      position: fixed;
      bottom: 24px;
      right: 24px;
      display: flex;
      flex-direction: column;
      gap: 8px;
      z-index: 100;
    }

    .toast {
      background: #18181b;
      border: 1px solid var(--border);
      color: var(--text);
      padding: 12px 18px;
      border-radius: 8px;
      font-size: 0.85rem;
      display: flex;
      align-items: center;
      gap: 10px;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
      animation: slideIn 0.2s ease-out;
    }

    .toast-indicator {
      width: 6px;
      height: 6px;
      border-radius: 50%;
    }

    .toast.success .toast-indicator { background: #10b981; }
    .toast.error .toast-indicator { background: #ef4444; }
    .toast.info .toast-indicator { background: #38bdf8; }

    @keyframes slideIn {
      from { transform: translateY(10px); opacity: 0; }
      to { transform: translateY(0); opacity: 1; }
    }
  `]
})
export class App implements OnInit, OnDestroy {
  routes: Route[] = [];
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
    this.fetchRoutes();
    // Poll every 3 seconds to reflect out-of-band updates (psql, etc.)
    this.pollTimer = setInterval(() => this.fetchRoutes(false), 3000);
  }

  ngOnDestroy() {
    if (this.pollTimer) clearInterval(this.pollTimer);
  }

  fetchRoutes(showLoading = true) {
    if (showLoading) this.isLoading = true;

    fetch('/api/routes')
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
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
        this.fetchRoutes(false);
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
        this.fetchRoutes(false);
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
