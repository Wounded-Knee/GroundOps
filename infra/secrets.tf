locals {
  google_secret_names = [
    "GOOGLE_ANDROID_CLIENT_ID",
    "GOOGLE_IOS_CLIENT_ID",
    "GOOGLE_MAPS_API_KEY",
    "GOOGLE_WEB_CLIENT_ID",
    "GOOGLE_WEB_CLIENT_SECRET",
  ]
}

resource "aws_secretsmanager_secret" "database_url" {
  name = "groundops/DATABASE_URL"
}

resource "aws_secretsmanager_secret_version" "database_url" {
  secret_id = aws_secretsmanager_secret.database_url.id
  secret_string = format(
    "postgres://groundops:%s@%s:%s/groundops?sslmode=require",
    random_password.database.result,
    aws_db_instance.main.address,
    aws_db_instance.main.port,
  )
}

resource "aws_secretsmanager_secret" "google" {
  for_each = toset(local.google_secret_names)

  name = "groundops/${each.key}"
}

resource "aws_secretsmanager_secret_version" "google" {
  for_each = aws_secretsmanager_secret.google

  secret_id     = each.value.id
  secret_string = "replace-me"

  lifecycle {
    ignore_changes = [secret_string]
  }
}
