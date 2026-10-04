package main

import (
	"context"
	"log"
	"os"
	"os/signal"
	"syscall"

	"github.com/adimail/KubeIngress/control-plane/internal/api"
	"github.com/adimail/KubeIngress/control-plane/internal/db"
	"github.com/adimail/KubeIngress/control-plane/internal/server"
)

func main() {
	log.Println("Starting KubeIngress Control Plane...")

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		dbURL = "postgres://postgres:postgres@localhost:5432/kubeingress?sslmode=disable"
	}

	dbClient, err := db.NewClient(dbURL)
	if err != nil {
		log.Fatalf("Database connection failed: %v", err)
	}
	defer dbClient.Close()

	xdsServer := server.New(dbClient)
	go func() {
		if err := xdsServer.Start(ctx, 18000); err != nil {
			log.Fatalf("xDS Server failed: %v", err)
		}
	}()

	apiServer := api.NewServer(8080, dbClient, xdsServer)
	go func() {
		if err := apiServer.Start(); err != nil {
			log.Fatalf("API Server failed: %v", err)
		}
	}()

	<-ctx.Done()
	log.Println("Shutting down KubeIngress Control Plane gracefully...")
	apiServer.Shutdown(context.Background())
}
