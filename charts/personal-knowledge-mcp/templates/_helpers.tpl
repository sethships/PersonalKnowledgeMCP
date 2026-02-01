{{/*
Personal Knowledge MCP - Helm Chart Helper Templates
*/}}

{{/*
Expand the name of the chart.
*/}}
{{- define "pk-mcp.name" -}}
{{- default .Chart.Name .Values.global.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
We truncate at 63 chars because some Kubernetes name fields are limited to this (by the DNS naming spec).
If release name contains chart name it will be used as a full name.
*/}}
{{- define "pk-mcp.fullname" -}}
{{- if .Values.global.fullnameOverride }}
{{- .Values.global.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.global.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Create chart name and version as used by the chart label.
*/}}
{{- define "pk-mcp.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "pk-mcp.labels" -}}
helm.sh/chart: {{ include "pk-mcp.chart" . }}
{{ include "pk-mcp.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/part-of: pk-mcp
{{- if .Values.instance.name }}
app.kubernetes.io/instance-name: {{ .Values.instance.name }}
{{- end }}
{{- with .Values.global.labels }}
{{ toYaml . }}
{{- end }}
{{- end }}

{{/*
Selector labels
*/}}
{{- define "pk-mcp.selectorLabels" -}}
app.kubernetes.io/name: {{ include "pk-mcp.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Component labels for MCP Service
*/}}
{{- define "pk-mcp.mcpService.labels" -}}
{{ include "pk-mcp.labels" . }}
app.kubernetes.io/component: mcp-service
{{- end }}

{{/*
Selector labels for MCP Service
*/}}
{{- define "pk-mcp.mcpService.selectorLabels" -}}
{{ include "pk-mcp.selectorLabels" . }}
app.kubernetes.io/component: mcp-service
{{- end }}

{{/*
Component labels for ChromaDB
*/}}
{{- define "pk-mcp.chromadb.labels" -}}
{{ include "pk-mcp.labels" . }}
app.kubernetes.io/component: chromadb
{{- end }}

{{/*
Selector labels for ChromaDB
*/}}
{{- define "pk-mcp.chromadb.selectorLabels" -}}
{{ include "pk-mcp.selectorLabels" . }}
app.kubernetes.io/component: chromadb
{{- end }}

{{/*
Component labels for PostgreSQL
*/}}
{{- define "pk-mcp.postgres.labels" -}}
{{ include "pk-mcp.labels" . }}
app.kubernetes.io/component: postgres
{{- end }}

{{/*
Selector labels for PostgreSQL
*/}}
{{- define "pk-mcp.postgres.selectorLabels" -}}
{{ include "pk-mcp.selectorLabels" . }}
app.kubernetes.io/component: postgres
{{- end }}

{{/*
Create the name of the service account to use for MCP Service
*/}}
{{- define "pk-mcp.serviceAccountName" -}}
{{- if .Values.mcpService.serviceAccount.create }}
{{- default (printf "%s-service" (include "pk-mcp.fullname" .)) .Values.mcpService.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.mcpService.serviceAccount.name }}
{{- end }}
{{- end }}

{{/*
Create the name of the secret to use
*/}}
{{- define "pk-mcp.secretName" -}}
{{- if .Values.secrets.existingSecret }}
{{- .Values.secrets.existingSecret }}
{{- else }}
{{- printf "%s-secrets" (include "pk-mcp.fullname" .) }}
{{- end }}
{{- end }}

{{/*
Create the namespace to use
*/}}
{{- define "pk-mcp.namespace" -}}
{{- if .Values.global.namespace.name }}
{{- .Values.global.namespace.name }}
{{- else }}
{{- .Release.Namespace }}
{{- end }}
{{- end }}

{{/*
ChromaDB hostname (internal service DNS)
*/}}
{{- define "pk-mcp.chromadbHost" -}}
{{- if .Values.chromadb.enabled }}
{{- printf "%s-chromadb" (include "pk-mcp.fullname" .) }}
{{- else }}
{{- "chromadb" }}
{{- end }}
{{- end }}

{{/*
ChromaDB port
*/}}
{{- define "pk-mcp.chromadbPort" -}}
{{- if .Values.chromadb.enabled }}
{{- .Values.chromadb.service.port | default 8000 }}
{{- else }}
{{- 8000 }}
{{- end }}
{{- end }}

{{/*
PostgreSQL hostname (internal service DNS)
*/}}
{{- define "pk-mcp.postgresHost" -}}
{{- if .Values.postgres.enabled }}
{{- printf "%s-postgres" (include "pk-mcp.fullname" .) }}
{{- else }}
{{- "postgres" }}
{{- end }}
{{- end }}

{{/*
PostgreSQL port
*/}}
{{- define "pk-mcp.postgresPort" -}}
{{- if .Values.postgres.enabled }}
{{- .Values.postgres.service.port | default 5432 }}
{{- else }}
{{- 5432 }}
{{- end }}
{{- end }}

{{/*
Common annotations
*/}}
{{- define "pk-mcp.annotations" -}}
{{- with .Values.global.annotations }}
{{ toYaml . }}
{{- end }}
{{- end }}

{{/*
MCP Service full name
*/}}
{{- define "pk-mcp.mcpService.fullname" -}}
{{- printf "%s-service" (include "pk-mcp.fullname" .) }}
{{- end }}

{{/*
ChromaDB full name
*/}}
{{- define "pk-mcp.chromadb.fullname" -}}
{{- printf "%s-chromadb" (include "pk-mcp.fullname" .) }}
{{- end }}

{{/*
PostgreSQL full name
*/}}
{{- define "pk-mcp.postgres.fullname" -}}
{{- printf "%s-postgres" (include "pk-mcp.fullname" .) }}
{{- end }}

{{/*
ConfigMap name for MCP Service
*/}}
{{- define "pk-mcp.mcpService.configMapName" -}}
{{- printf "%s-config" (include "pk-mcp.fullname" .) }}
{{- end }}

{{/*
ConfigMap name for ChromaDB
*/}}
{{- define "pk-mcp.chromadb.configMapName" -}}
{{- printf "%s-chromadb-config" (include "pk-mcp.fullname" .) }}
{{- end }}

{{/*
ConfigMap name for PostgreSQL
*/}}
{{- define "pk-mcp.postgres.configMapName" -}}
{{- printf "%s-postgres-config" (include "pk-mcp.fullname" .) }}
{{- end }}

{{/*
Ingress full name
*/}}
{{- define "pk-mcp.ingress.fullname" -}}
{{- printf "%s-ingress" (include "pk-mcp.fullname" .) }}
{{- end }}

{{/*
Check if ChromaDB authentication is enabled
Uses explicit auth.enabled flag for clarity
*/}}
{{- define "pk-mcp.chromadb.authEnabled" -}}
{{- if .Values.chromadb.auth.enabled }}
{{- true }}
{{- else }}
{{- false }}
{{- end }}
{{- end }}
