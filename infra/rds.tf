data "aws_rds_engine_version" "postgres16" {
  engine  = "postgres"
  version = "16"
  latest  = true
}

resource "random_password" "database" {
  length  = 32
  special = false
}

resource "aws_db_subnet_group" "main" {
  name       = "groundops"
  subnet_ids = aws_subnet.private[*].id

  tags = {
    Name = "groundops"
  }
}

resource "aws_db_instance" "main" {
  identifier     = "groundops"
  engine         = "postgres"
  instance_class = "db.t4g.micro"

  allocated_storage = 20
  storage_type      = "gp3"
  storage_encrypted = true

  db_name  = "groundops"
  username = "groundops"
  password = random_password.database.result

  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.database.id]
  publicly_accessible    = false
  multi_az               = false

  backup_retention_period    = 7
  copy_tags_to_snapshot      = true
  deletion_protection        = true
  skip_final_snapshot        = false
  final_snapshot_identifier  = "groundops-final"
  apply_immediately          = true
  auto_minor_version_upgrade = true
  engine_version             = data.aws_rds_engine_version.postgres16.version_actual

  tags = {
    Name = "groundops"
  }

  lifecycle {
    ignore_changes = [engine_version]
  }
}
