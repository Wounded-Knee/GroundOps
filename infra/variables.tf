variable "aws_region" {
  description = "Region for the Groundops runtime. Match the region used for infra/bootstrap."
  type        = string
  default     = "us-east-1"
}

variable "image_tag" {
  description = "Tag of the groundops-api image in ECR. GitHub Actions sets this to the commit SHA."
  type        = string
  default     = "bootstrap"
}
