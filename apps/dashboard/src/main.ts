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
  tenant_id: string;
  status: string;
  healthy_pods: number;
  total_pods: number;
}

interface Toast {
  id: number;
  message: string;
  type: 'success' | 'error';
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule],
  styleUrl: './app/app.component.css',
  template: `
    <div class="container">
      <header class="header">
        <h1>KubeIngress</h1>
        <div class="header-actions">
          <button class="btn-refresh" (click)="refresh()" [disabled]="isRefreshing">
            {{ isRefreshing ? 'Refreshing...' : '↻ Refresh' }}
          </button>
          <div class="status-pill" [class.online]="backendOnline">
            <span class="dot"></span>
            {{ backendOnline ? connectedProxies + ' Proxy Active' : 'Disconnected' }}
          </div>
        </div>
      </header>

      <div class="card form-card">
        <form (ngSubmit)="addRoute()" class="form-row">
          <input [(ngModel)]="newRoute.tenant_id" name="tenant" placeholder="Tenant (e.g. blog)" required />
          <input [(ngModel)]="newRoute.host" name="host" placeholder="Host (e.g. blog.local)" required />
          <input [(ngModel)]="newRoute.upstream_service" name="service" placeholder="Service FQDN" required class="input-grow" />
          <input [(ngModel)]="newRoute.upstream_port" name="port" type="number" placeholder="Port" required class="input-port" />
          <button type="submit" class="btn-add" [disabled]="isSubmitting || !backendOnline">
            {{ isSubmitting ? 'Adding...' : '+ Add Route' }}
          </button>
        </form>
      </div>

      <div class="card">
        <table>
          <thead>
            <tr>
              <th>Tenant</th>
              <th>Public Domain</th>
              <th>Upstream Target</th>
              <th>Pods</th>
              <th class="text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            <tr *ngFor="let r of routes">
              <td><span class="tag">{{ r.tenant_id }}</span></td>
              <td>
                <a [href]="'http://' + r.host" target="_blank" class="host-link">
                  {{ r.host }} ↗
                </a>
              </td>
              <td class="font-mono text-muted">{{ r.upstream_service }}:{{ r.upstream_port }}</td>
              <td>
                <span class="health" [class.ok]="getHealth(r.tenant_id).ok">
                  ● {{ getHealth(r.tenant_id).text }}
                </span>
              </td>
              <td class="text-right">
                <button class="btn-delete" (click)="deleteRoute(r.id, r.host)">Delete</button>
              </td>
            </tr>
            <tr *ngIf="routes.length === 0 && !isLoading">
              <td colspan="5" class="empty">No routes published. Add one above.</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="toasts">
        <div *ngFor="let t of toasts" class="toast" [class]="t.type">
          {{ t.message }}
        </div>
      </div>
    </div>
  `
})
export class App implements OnInit, OnDestroy {
  routes: Route[] = [];
  clusters: ClusterHealth[] = [];
  connectedProxies = 0;
  backendOnline = false;
  isLoading = true;
  isSubmitting = false;
  isRefreshing = false;
  toasts: Toast[] = [];

  newRoute = {
    tenant_id: '',
    host: '',
    upstream_service: '',
    upstream_port: 80
  };

  private timer: any;

  ngOnInit() {
    this.refresh();
    this.timer = setInterval(() => this.refresh(false), 4000);
  }

  ngOnDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  refresh(manual = true) {
    if (manual) this.isRefreshing = true;

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
        this.connectedProxies = data?.control_plane?.connected_proxies || 0;
        this.clusters = data?.clusters || [];
      })
      .catch(() => {})
      .finally(() => {
        if (manual) setTimeout(() => this.isRefreshing = false, 300);
      });
  }

  getHealth(tenantId: string) {
    const c = this.clusters.find(cl => cl.tenant_id === tenantId);
    if (!c) return { ok: false, text: 'Pending' };
    return {
      ok: c.status === 'HEALTHY',
      text: `${c.healthy_pods}/${c.total_pods} Healthy`
    };
  }

  addRoute() {
    if (!this.newRoute.tenant_id || !this.newRoute.host || !this.newRoute.upstream_service) {
      this.toast('All fields are required', 'error');
      return;
    }

    this.isSubmitting = true;

    fetch('/api/routes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(this.newRoute)
    })
      .then(res => {
        if (!res.ok) throw new Error();
        this.toast(`Route ${this.newRoute.host} published`, 'success');
        this.newRoute = { tenant_id: '', host: '', upstream_service: '', upstream_port: 80 };
        this.refresh(false);
      })
      .catch(() => this.toast('Failed to publish route', 'error'))
      .finally(() => this.isSubmitting = false);
  }

  deleteRoute(id: number, host: string) {
    fetch(`/api/routes?id=${id}`, { method: 'DELETE' })
      .then(res => {
        if (!res.ok) throw new Error();
        this.toast(`Deleted ${host}`, 'success');
        this.refresh(false);
      })
      .catch(() => this.toast('Failed to delete route', 'error'));
  }

  toast(message: string, type: 'success' | 'error') {
    const id = Date.now();
    this.toasts.push({ id, message, type });
    setTimeout(() => {
      this.toasts = this.toasts.filter(t => t.id !== id);
    }, 3500);
  }
}

bootstrapApplication(App);
