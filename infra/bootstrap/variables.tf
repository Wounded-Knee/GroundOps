variable "aws_region" {
  description = "Region for the state bucket, lock table, and deploy role."
  type        = string
  default     = "us-east-1"
}

variable "github_repository" {
  description = "GitHub repository allowed to assume the deploy role, as OWNER/NAME."
  type        = string
  default     = "Wounded-Knee/GroundOps"
}

variable "github_branch" {
  description = "Branch allowed to assume the deploy role."
  type        = string
  default     = "main"
}
