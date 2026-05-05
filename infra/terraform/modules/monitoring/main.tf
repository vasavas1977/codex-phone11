# =============================================================================
# CloudPhone11 — Monitoring Stack (Prometheus + Grafana)
# =============================================================================
# Deploys kube-prometheus-stack via Helm with VoIP-specific scrape configs,
# alerting rules, and pre-built Grafana dashboards.
# =============================================================================

variable "namespace" {
  description = "Kubernetes namespace for monitoring"
  type        = string
  default     = "monitoring"
}

variable "app_namespace" {
  description = "Namespace where CloudPhone11 services run"
  type        = string
  default     = "cloudphone11"
}

variable "grafana_admin_password" {
  description = "Grafana admin password"
  type        = string
  sensitive   = true
}

variable "grafana_domain" {
  description = "Domain for Grafana ingress"
  type        = string
}

variable "storage_class" {
  description = "Storage class for persistent volumes"
  type        = string
  default     = "gp3"
}

variable "prometheus_retention" {
  description = "Prometheus data retention period"
  type        = string
  default     = "30d"
}

variable "prometheus_storage_size" {
  description = "Prometheus PVC size"
  type        = string
  default     = "100Gi"
}

variable "grafana_storage_size" {
  description = "Grafana PVC size"
  type        = string
  default     = "10Gi"
}

variable "alertmanager_slack_webhook" {
  description = "Slack webhook URL for alert notifications"
  type        = string
  default     = ""
  sensitive   = true
}

variable "alertmanager_email" {
  description = "Email for alert notifications"
  type        = string
  default     = ""
}

variable "tls_cert_arn" {
  description = "ACM certificate ARN for Grafana TLS"
  type        = string
  default     = ""
}

# -----------------------------------------------------------------------------
# Namespace
# -----------------------------------------------------------------------------
resource "kubernetes_namespace" "monitoring" {
  metadata {
    name = var.namespace
    labels = {
      "app.kubernetes.io/managed-by" = "terraform"
      "purpose"                      = "monitoring"
    }
  }
}

# -----------------------------------------------------------------------------
# Prometheus + Grafana via kube-prometheus-stack Helm chart
# -----------------------------------------------------------------------------
resource "helm_release" "kube_prometheus_stack" {
  name       = "kube-prometheus-stack"
  repository = "https://prometheus-community.github.io/helm-charts"
  chart      = "kube-prometheus-stack"
  version    = "62.7.0"
  namespace  = kubernetes_namespace.monitoring.metadata[0].name
  timeout    = 900

  # --- Prometheus ---
  set {
    name  = "prometheus.prometheusSpec.retention"
    value = var.prometheus_retention
  }

  set {
    name  = "prometheus.prometheusSpec.storageSpec.volumeClaimTemplate.spec.storageClassName"
    value = var.storage_class
  }

  set {
    name  = "prometheus.prometheusSpec.storageSpec.volumeClaimTemplate.spec.resources.requests.storage"
    value = var.prometheus_storage_size
  }

  set {
    name  = "prometheus.prometheusSpec.resources.requests.cpu"
    value = "500m"
  }

  set {
    name  = "prometheus.prometheusSpec.resources.requests.memory"
    value = "1Gi"
  }

  set {
    name  = "prometheus.prometheusSpec.resources.limits.cpu"
    value = "2"
  }

  set {
    name  = "prometheus.prometheusSpec.resources.limits.memory"
    value = "4Gi"
  }

  # Enable ServiceMonitor auto-discovery across namespaces
  set {
    name  = "prometheus.prometheusSpec.serviceMonitorSelectorNilUsesHelmValues"
    value = "false"
  }

  set {
    name  = "prometheus.prometheusSpec.podMonitorSelectorNilUsesHelmValues"
    value = "false"
  }

  # --- Grafana ---
  set {
    name  = "grafana.adminPassword"
    value = var.grafana_admin_password
  }

  set {
    name  = "grafana.persistence.enabled"
    value = "true"
  }

  set {
    name  = "grafana.persistence.storageClassName"
    value = var.storage_class
  }

  set {
    name  = "grafana.persistence.size"
    value = var.grafana_storage_size
  }

  set {
    name  = "grafana.ingress.enabled"
    value = "true"
  }

  set {
    name  = "grafana.ingress.ingressClassName"
    value = "nginx"
  }

  set {
    name  = "grafana.ingress.hosts[0]"
    value = var.grafana_domain
  }

  set {
    name  = "grafana.ingress.annotations.cert-manager\\.io/cluster-issuer"
    value = "letsencrypt-prod"
  }

  set {
    name  = "grafana.ingress.tls[0].secretName"
    value = "grafana-tls"
  }

  set {
    name  = "grafana.ingress.tls[0].hosts[0]"
    value = var.grafana_domain
  }

  # Grafana plugins
  set {
    name  = "grafana.plugins[0]"
    value = "grafana-piechart-panel"
  }

  set {
    name  = "grafana.plugins[1]"
    value = "grafana-clock-panel"
  }

  # --- Alertmanager ---
  set {
    name  = "alertmanager.alertmanagerSpec.storage.volumeClaimTemplate.spec.storageClassName"
    value = var.storage_class
  }

  set {
    name  = "alertmanager.alertmanagerSpec.storage.volumeClaimTemplate.spec.resources.requests.storage"
    value = "5Gi"
  }

  # --- Node Exporter ---
  set {
    name  = "nodeExporter.enabled"
    value = "true"
  }

  # --- kube-state-metrics ---
  set {
    name  = "kubeStateMetrics.enabled"
    value = "true"
  }

  values = [yamlencode({
    # Additional scrape configs for VoIP services
    prometheus = {
      prometheusSpec = {
        additionalScrapeConfigs = [
          {
            job_name        = "freeswitch"
            scrape_interval = "15s"
            metrics_path    = "/metrics"
            static_configs = [{
              targets = ["freeswitch.${var.app_namespace}.svc.cluster.local:8021"]
              labels  = { service = "freeswitch", component = "media-server" }
            }]
          },
          {
            job_name        = "kamailio"
            scrape_interval = "15s"
            metrics_path    = "/metrics"
            static_configs = [{
              targets = ["kamailio.${var.app_namespace}.svc.cluster.local:9494"]
              labels  = { service = "kamailio", component = "sip-proxy" }
            }]
          },
          {
            job_name        = "flexisip"
            scrape_interval = "30s"
            metrics_path    = "/metrics"
            static_configs = [{
              targets = ["flexisip.${var.app_namespace}.svc.cluster.local:9100"]
              labels  = { service = "flexisip", component = "push-gateway" }
            }]
          },
          {
            job_name        = "backend-api"
            scrape_interval = "15s"
            metrics_path    = "/metrics"
            static_configs = [{
              targets = ["backend.${var.app_namespace}.svc.cluster.local:3000"]
              labels  = { service = "backend", component = "api" }
            }]
          },
          {
            job_name        = "rtpengine"
            scrape_interval = "15s"
            metrics_path    = "/metrics"
            static_configs = [{
              targets = ["rtpengine.${var.app_namespace}.svc.cluster.local:22223"]
              labels  = { service = "rtpengine", component = "media-relay" }
            }]
          }
        ]
      }
    }

    # Alertmanager routing
    alertmanager = {
      config = {
        global = {
          resolve_timeout = "5m"
        }
        route = {
          group_by        = ["alertname", "namespace", "service"]
          group_wait      = "30s"
          group_interval  = "5m"
          repeat_interval = "4h"
          receiver        = "default"
          routes = [
            {
              match    = { severity = "critical" }
              receiver = "critical"
              repeat_interval = "1h"
            },
            {
              match    = { severity = "warning" }
              receiver = "warning"
              repeat_interval = "4h"
            }
          ]
        }
        receivers = [
          {
            name = "default"
          },
          {
            name = "critical"
            slack_configs = var.alertmanager_slack_webhook != "" ? [{
              api_url  = var.alertmanager_slack_webhook
              channel  = "#cloudphone11-alerts"
              title    = "{{ .GroupLabels.alertname }}"
              text     = "{{ range .Alerts }}{{ .Annotations.description }}\n{{ end }}"
              send_resolved = true
            }] : []
          },
          {
            name = "warning"
            slack_configs = var.alertmanager_slack_webhook != "" ? [{
              api_url  = var.alertmanager_slack_webhook
              channel  = "#cloudphone11-warnings"
              title    = "{{ .GroupLabels.alertname }}"
              text     = "{{ range .Alerts }}{{ .Annotations.description }}\n{{ end }}"
            }] : []
          }
        ]
      }
    }
  })]
}

# -----------------------------------------------------------------------------
# ServiceMonitors for CloudPhone11 services
# -----------------------------------------------------------------------------
resource "kubernetes_manifest" "freeswitch_service_monitor" {
  manifest = {
    apiVersion = "monitoring.coreos.com/v1"
    kind       = "ServiceMonitor"
    metadata = {
      name      = "freeswitch"
      namespace = var.app_namespace
      labels = {
        app     = "freeswitch"
        release = "kube-prometheus-stack"
      }
    }
    spec = {
      selector = {
        matchLabels = { app = "freeswitch" }
      }
      endpoints = [{
        port     = "metrics"
        interval = "15s"
        path     = "/metrics"
      }]
    }
  }

  depends_on = [helm_release.kube_prometheus_stack]
}

resource "kubernetes_manifest" "kamailio_service_monitor" {
  manifest = {
    apiVersion = "monitoring.coreos.com/v1"
    kind       = "ServiceMonitor"
    metadata = {
      name      = "kamailio"
      namespace = var.app_namespace
      labels = {
        app     = "kamailio"
        release = "kube-prometheus-stack"
      }
    }
    spec = {
      selector = {
        matchLabels = { app = "kamailio" }
      }
      endpoints = [{
        port     = "metrics"
        interval = "15s"
        path     = "/metrics"
      }]
    }
  }

  depends_on = [helm_release.kube_prometheus_stack]
}

resource "kubernetes_manifest" "backend_service_monitor" {
  manifest = {
    apiVersion = "monitoring.coreos.com/v1"
    kind       = "ServiceMonitor"
    metadata = {
      name      = "backend"
      namespace = var.app_namespace
      labels = {
        app     = "backend"
        release = "kube-prometheus-stack"
      }
    }
    spec = {
      selector = {
        matchLabels = { app = "backend" }
      }
      endpoints = [{
        port     = "http"
        interval = "15s"
        path     = "/metrics"
      }]
    }
  }

  depends_on = [helm_release.kube_prometheus_stack]
}

# -----------------------------------------------------------------------------
# Outputs
# -----------------------------------------------------------------------------
output "grafana_url" {
  description = "Grafana dashboard URL"
  value       = "https://${var.grafana_domain}"
}

output "prometheus_service" {
  description = "Prometheus internal service endpoint"
  value       = "kube-prometheus-stack-prometheus.${var.namespace}.svc.cluster.local:9090"
}

output "alertmanager_service" {
  description = "Alertmanager internal service endpoint"
  value       = "kube-prometheus-stack-alertmanager.${var.namespace}.svc.cluster.local:9093"
}
