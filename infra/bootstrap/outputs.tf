output "state_bucket" {
  description = "S3 bucket for the main stack's Terraform state."
  value       = aws_s3_bucket.state.bucket
}

output "lock_table" {
  description = "DynamoDB table that locks the main stack's Terraform state."
  value       = aws_dynamodb_table.locks.name
}

output "deploy_role_arn" {
  description = "IAM role ARN for the AWS_ROLE_ARN GitHub repository variable."
  value       = aws_iam_role.deploy.arn
}
