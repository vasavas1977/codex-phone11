# =============================================================================
# CloudPhone11 — Kubernetes Service Deployments via Terraform
# Deploys all VoIP services to EKS after infrastructure is provisioned
# =============================================================================

# -----------------------------------------------------------------------------
# Namespace
# -----------------------------------------------------------------------------
resource "kubernetes_namespace" "cloudphone11" {
  metadata {
    name = var.project_name
    labels = {
      app         = var.project_name
      environment = var.environment
    }
  }

  depends_on = [module.eks]
}

# -----------------------------------------------------------------------------
# ConfigMap — Shared configuration
# -----------------------------------------------------------------------------
resource "kubernetes_config_map" "app_config" {
  metadata {
    name      = "app-config"
    namespace = kubernetes_namespace.cloudphone11.metadata[0].name
  }

  data = {
    DOMAIN_NAME       = var.domain_name
    SIP_DOMAIN        = "sip.${var.domain_name}"
    API_URL           = "https://api.${var.domain_name}"
    WSS_URL           = "wss://wss.${var.domain_name}:7443"
    PUSH_GATEWAY_URL  = "https://push.${var.domain_name}"
    RECORDINGS_BUCKET = module.s3.recordings_bucket_name
    VOICEMAIL_BUCKET  = module.s3.voicemail_bucket_name
    AWS_REGION        = var.aws_region
    NODE_ENV          = "production"
    RTP_PORT_MIN      = tostring(var.rtp_port_min)
    RTP_PORT_MAX      = tostring(var.rtp_port_max)
  }
}

# -----------------------------------------------------------------------------
# Secret — Database and service credentials
# -----------------------------------------------------------------------------
resource "kubernetes_secret" "app_secrets" {
  metadata {
    name      = "app-secrets"
    namespace = kubernetes_namespace.cloudphone11.metadata[0].name
  }

  data = {
    DATABASE_URL     = module.rds.connection_string
    REDIS_URL        = module.elasticache.connection_string
    RDS_PASSWORD     = var.rds_password
    FCM_SERVER_KEY   = var.fcm_server_key
  }

  type = "Opaque"
}

# -----------------------------------------------------------------------------
# Deployment: PostgreSQL init job (run Kamailio schema + CDR tables)
# -----------------------------------------------------------------------------
resource "kubernetes_job" "db_init" {
  metadata {
    name      = "db-init"
    namespace = kubernetes_namespace.cloudphone11.metadata[0].name
  }

  spec {
    template {
      metadata {
        labels = { app = "db-init" }
      }
      spec {
        restart_policy = "Never"
        container {
          name  = "db-init"
          image = "postgres:16-alpine"
          command = [
            "sh", "-c",
            "psql $DATABASE_URL -f /sql/init-db.sql"
          ]
          env {
            name = "DATABASE_URL"
            value_from {
              secret_key_ref {
                name = kubernetes_secret.app_secrets.metadata[0].name
                key  = "DATABASE_URL"
              }
            }
          }
        }
      }
    }
    backoff_limit = 3
  }

  depends_on = [module.rds]
}

# -----------------------------------------------------------------------------
# Deployment: FreeSWITCH
# -----------------------------------------------------------------------------
resource "kubernetes_deployment" "freeswitch" {
  metadata {
    name      = "freeswitch"
    namespace = kubernetes_namespace.cloudphone11.metadata[0].name
    labels    = { app = "freeswitch" }
  }

  spec {
    replicas = 1
    selector {
      match_labels = { app = "freeswitch" }
    }

    template {
      metadata {
        labels = { app = "freeswitch" }
      }
      spec {
        host_network = true
        dns_policy   = "ClusterFirstWithHostNet"

        node_selector = { role = "voip" }
        toleration {
          key      = "voip"
          operator = "Equal"
          value    = "true"
          effect   = "NoSchedule"
        }

        container {
          name  = "freeswitch"
          image = "${module.ecr.repository_urls["freeswitch"]}:latest"

          port {
            container_port = 5060
            protocol       = "UDP"
          }
          port {
            container_port = 5060
            protocol       = "TCP"
          }
          port {
            container_port = 5080
            protocol       = "UDP"
          }
          port {
            container_port = 8021
            protocol       = "TCP"
          }

          env_from {
            config_map_ref { name = kubernetes_config_map.app_config.metadata[0].name }
          }
          env_from {
            secret_ref { name = kubernetes_secret.app_secrets.metadata[0].name }
          }

          volume_mount {
            name       = "recordings"
            mount_path = "/var/lib/freeswitch/recordings"
          }

          resources {
            requests = { cpu = "500m", memory = "512Mi" }
            limits   = { cpu = "2000m", memory = "2Gi" }
          }

          liveness_probe {
            tcp_socket { port = 8021 }
            initial_delay_seconds = 30
            period_seconds        = 10
          }
        }

        volume {
          name = "recordings"
          persistent_volume_claim { claim_name = "recordings-pvc" }
        }
      }
    }
  }
}

# -----------------------------------------------------------------------------
# Deployment: Kamailio
# -----------------------------------------------------------------------------
resource "kubernetes_deployment" "kamailio" {
  metadata {
    name      = "kamailio"
    namespace = kubernetes_namespace.cloudphone11.metadata[0].name
    labels    = { app = "kamailio" }
  }

  spec {
    replicas = 2
    selector {
      match_labels = { app = "kamailio" }
    }

    template {
      metadata {
        labels = { app = "kamailio" }
      }
      spec {
        node_selector = { role = "voip" }
        toleration {
          key      = "voip"
          operator = "Equal"
          value    = "true"
          effect   = "NoSchedule"
        }

        container {
          name  = "kamailio"
          image = "${module.ecr.repository_urls["kamailio"]}:latest"

          port {
            container_port = 5060
            protocol       = "UDP"
          }
          port {
            container_port = 5060
            protocol       = "TCP"
          }
          port {
            container_port = 5061
            protocol       = "TCP"
          }
          port {
            container_port = 7443
            protocol       = "TCP"
          }

          env_from {
            config_map_ref { name = kubernetes_config_map.app_config.metadata[0].name }
          }
          env_from {
            secret_ref { name = kubernetes_secret.app_secrets.metadata[0].name }
          }

          resources {
            requests = { cpu = "250m", memory = "256Mi" }
            limits   = { cpu = "1000m", memory = "1Gi" }
          }

          liveness_probe {
            exec {
              command = ["kamctl", "monitor", "1"]
            }
            initial_delay_seconds = 15
            period_seconds        = 10
          }
        }
      }
    }
  }
}

# -----------------------------------------------------------------------------
# Deployment: Flexisip (Push Gateway)
# -----------------------------------------------------------------------------
resource "kubernetes_deployment" "flexisip" {
  metadata {
    name      = "flexisip"
    namespace = kubernetes_namespace.cloudphone11.metadata[0].name
    labels    = { app = "flexisip" }
  }

  spec {
    replicas = 1
    selector {
      match_labels = { app = "flexisip" }
    }

    template {
      metadata {
        labels = { app = "flexisip" }
      }
      spec {
        container {
          name  = "flexisip"
          image = "${module.ecr.repository_urls["flexisip"]}:latest"

          port {
            container_port = 5065
            protocol       = "TCP"
          }

          env_from {
            config_map_ref { name = kubernetes_config_map.app_config.metadata[0].name }
          }
          env_from {
            secret_ref { name = kubernetes_secret.app_secrets.metadata[0].name }
          }

          resources {
            requests = { cpu = "100m", memory = "128Mi" }
            limits   = { cpu = "500m", memory = "512Mi" }
          }

          liveness_probe {
            tcp_socket { port = 5065 }
            initial_delay_seconds = 10
            period_seconds        = 10
          }
        }
      }
    }
  }
}

# -----------------------------------------------------------------------------
# Deployment: Backend API
# -----------------------------------------------------------------------------
resource "kubernetes_deployment" "backend" {
  metadata {
    name      = "backend"
    namespace = kubernetes_namespace.cloudphone11.metadata[0].name
    labels    = { app = "backend" }
  }

  spec {
    replicas = 2
    selector {
      match_labels = { app = "backend" }
    }

    template {
      metadata {
        labels = { app = "backend" }
      }
      spec {
        container {
          name  = "backend"
          image = "${module.ecr.repository_urls["backend"]}:latest"

          port {
            container_port = 3000
            protocol       = "TCP"
          }

          env_from {
            config_map_ref { name = kubernetes_config_map.app_config.metadata[0].name }
          }
          env_from {
            secret_ref { name = kubernetes_secret.app_secrets.metadata[0].name }
          }

          resources {
            requests = { cpu = "250m", memory = "256Mi" }
            limits   = { cpu = "1000m", memory = "1Gi" }
          }

          liveness_probe {
            http_get {
              path = "/health"
              port = 3000
            }
            initial_delay_seconds = 10
            period_seconds        = 10
          }

          readiness_probe {
            http_get {
              path = "/health"
              port = 3000
            }
            initial_delay_seconds = 5
            period_seconds        = 5
          }
        }
      }
    }
  }
}

# -----------------------------------------------------------------------------
# Services
# -----------------------------------------------------------------------------
resource "kubernetes_service" "freeswitch" {
  metadata {
    name      = "freeswitch"
    namespace = kubernetes_namespace.cloudphone11.metadata[0].name
  }
  spec {
    selector = { app = "freeswitch" }
    type     = "ClusterIP"
    port {
      name        = "sip-internal"
      port        = 5060
      target_port = 5060
      protocol    = "UDP"
    }
    port {
      name        = "esl"
      port        = 8021
      target_port = 8021
      protocol    = "TCP"
    }
  }
}

resource "kubernetes_service" "kamailio" {
  metadata {
    name      = "kamailio"
    namespace = kubernetes_namespace.cloudphone11.metadata[0].name
  }
  spec {
    selector = { app = "kamailio" }
    type     = "ClusterIP"
    port {
      name        = "sip-udp"
      port        = 5060
      target_port = 5060
      protocol    = "UDP"
    }
    port {
      name        = "sip-tls"
      port        = 5061
      target_port = 5061
      protocol    = "TCP"
    }
    port {
      name        = "wss"
      port        = 7443
      target_port = 7443
      protocol    = "TCP"
    }
  }
}

resource "kubernetes_service" "flexisip" {
  metadata {
    name      = "flexisip"
    namespace = kubernetes_namespace.cloudphone11.metadata[0].name
  }
  spec {
    selector = { app = "flexisip" }
    type     = "ClusterIP"
    port {
      name        = "sip"
      port        = 5065
      target_port = 5065
      protocol    = "TCP"
    }
  }
}

resource "kubernetes_service" "backend" {
  metadata {
    name      = "backend"
    namespace = kubernetes_namespace.cloudphone11.metadata[0].name
  }
  spec {
    selector = { app = "backend" }
    type     = "ClusterIP"
    port {
      name        = "http"
      port        = 3000
      target_port = 3000
      protocol    = "TCP"
    }
  }
}

# -----------------------------------------------------------------------------
# PVC: Recordings
# -----------------------------------------------------------------------------
resource "kubernetes_persistent_volume_claim" "recordings" {
  metadata {
    name      = "recordings-pvc"
    namespace = kubernetes_namespace.cloudphone11.metadata[0].name
  }
  spec {
    access_modes = ["ReadWriteOnce"]
    resources {
      requests = { storage = "200Gi" }
    }
    storage_class_name = "gp3"
  }
}

# -----------------------------------------------------------------------------
# Ingress: Backend API
# -----------------------------------------------------------------------------
resource "kubernetes_ingress_v1" "backend" {
  metadata {
    name      = "backend-ingress"
    namespace = kubernetes_namespace.cloudphone11.metadata[0].name
    annotations = {
      "kubernetes.io/ingress.class"                = "nginx"
      "cert-manager.io/cluster-issuer"             = "letsencrypt-prod"
      "nginx.ingress.kubernetes.io/ssl-redirect"   = "true"
      "nginx.ingress.kubernetes.io/proxy-body-size" = "50m"
    }
  }

  spec {
    tls {
      hosts       = ["api.${var.domain_name}"]
      secret_name = "api-tls"
    }

    rule {
      host = "api.${var.domain_name}"
      http {
        path {
          path      = "/"
          path_type = "Prefix"
          backend {
            service {
              name = kubernetes_service.backend.metadata[0].name
              port { number = 3000 }
            }
          }
        }
      }
    }
  }

  depends_on = [helm_release.nginx_ingress, helm_release.cert_manager]
}

# -----------------------------------------------------------------------------
# HPA: Backend
# -----------------------------------------------------------------------------
resource "kubernetes_horizontal_pod_autoscaler_v2" "backend" {
  metadata {
    name      = "backend-hpa"
    namespace = kubernetes_namespace.cloudphone11.metadata[0].name
  }

  spec {
    scale_target_ref {
      api_version = "apps/v1"
      kind        = "Deployment"
      name        = kubernetes_deployment.backend.metadata[0].name
    }

    min_replicas = 2
    max_replicas = 10

    metric {
      type = "Resource"
      resource {
        name = "cpu"
        target {
          type                = "Utilization"
          average_utilization = 70
        }
      }
    }
  }
}

# -----------------------------------------------------------------------------
# HPA: Kamailio
# -----------------------------------------------------------------------------
resource "kubernetes_horizontal_pod_autoscaler_v2" "kamailio" {
  metadata {
    name      = "kamailio-hpa"
    namespace = kubernetes_namespace.cloudphone11.metadata[0].name
  }

  spec {
    scale_target_ref {
      api_version = "apps/v1"
      kind        = "Deployment"
      name        = kubernetes_deployment.kamailio.metadata[0].name
    }

    min_replicas = 2
    max_replicas = 6

    metric {
      type = "Resource"
      resource {
        name = "cpu"
        target {
          type                = "Utilization"
          average_utilization = 60
        }
      }
    }
  }
}
