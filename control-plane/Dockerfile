FROM golang:1.25-alpine AS builder
WORKDIR /app

# Cache dependencies
COPY go.mod go.sum ./
RUN go mod download

# Copy source code and embedded migrations
COPY main.go .
COPY internal/ internal/

# Compile static binary
RUN CGO_ENABLED=0 GOOS=linux go build -o control-plane main.go

FROM alpine:latest
WORKDIR /root/
COPY --from=builder /app/control-plane .

EXPOSE 18000
CMD ["./control-plane"]
