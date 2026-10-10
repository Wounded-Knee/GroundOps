locals {
  runtime_secret_arns = concat(
    [aws_secretsmanager_secret.database_url.arn],
    [for secret in aws_secretsmanager_secret.google : secret.arn],
  )
}

output "alb_dns_name" {
  description = "Public DNS name of the API load balancer."
  value       = aws_lb.api.dns_name
}

output "health_url" {
  description = "Load balancer health check URL."
  value       = "http://${aws_lb.api.dns_name}/health"
}

output "ecr_repository_url" {
  description = "ECR repository URL for the API image, without a tag."
  value       = aws_ecr_repository.api.repository_url
}

output "ecs_cluster_name" {
  description = "ECS cluster name."
  value       = aws_ecs_cluster.main.name
}

output "ecs_service_name" {
  description = "ECS service name."
  value       = aws_ecs_service.api.name
}
