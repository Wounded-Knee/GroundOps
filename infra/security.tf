resource "aws_security_group" "alb" {
  name        = "groundops-alb"
  description = "Public HTTP entry for the Groundops API"
  vpc_id      = aws_vpc.main.id

  tags = {
    Name = "groundops-alb"
  }
}

resource "aws_security_group" "tasks" {
  name        = "groundops-tasks"
  description = "Groundops API tasks"
  vpc_id      = aws_vpc.main.id

  tags = {
    Name = "groundops-tasks"
  }
}

resource "aws_security_group" "database" {
  name        = "groundops-database"
  description = "Groundops Postgres"
  vpc_id      = aws_vpc.main.id

  tags = {
    Name = "groundops-database"
  }
}

resource "aws_vpc_security_group_ingress_rule" "alb_http" {
  security_group_id = aws_security_group.alb.id
  description       = "Public HTTP"
  ip_protocol       = "tcp"
  from_port         = 80
  to_port           = 80
  cidr_ipv4         = "0.0.0.0/0"
}

resource "aws_vpc_security_group_egress_rule" "alb_to_tasks" {
  security_group_id            = aws_security_group.alb.id
  description                  = "Forward to API tasks"
  ip_protocol                  = "tcp"
  from_port                    = 3000
  to_port                      = 3000
  referenced_security_group_id = aws_security_group.tasks.id
}

resource "aws_vpc_security_group_ingress_rule" "tasks_from_alb" {
  security_group_id            = aws_security_group.tasks.id
  description                  = "API port from the load balancer"
  ip_protocol                  = "tcp"
  from_port                    = 3000
  to_port                      = 3000
  referenced_security_group_id = aws_security_group.alb.id
}

resource "aws_vpc_security_group_egress_rule" "tasks_egress" {
  security_group_id = aws_security_group.tasks.id
  description       = "ECR, Google APIs, and Postgres"
  ip_protocol       = "-1"
  cidr_ipv4         = "0.0.0.0/0"
}

resource "aws_vpc_security_group_ingress_rule" "database_from_tasks" {
  security_group_id            = aws_security_group.database.id
  description                  = "Postgres from API tasks"
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
  referenced_security_group_id = aws_security_group.tasks.id
}
