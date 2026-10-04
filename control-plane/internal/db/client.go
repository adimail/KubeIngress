package db

import (
	"context"
	"database/sql"
	"embed"
	"errors"
	"fmt"
	"log"
	"time"

	"github.com/golang-migrate/migrate/v4"
	"github.com/golang-migrate/migrate/v4/database/postgres"
	"github.com/golang-migrate/migrate/v4/source/iofs"
	_ "github.com/lib/pq"
)

//go:embed migrations/*.sql
var migrationFiles embed.FS

type Route struct {
	ID              int       `json:"id"`
	TenantID        string    `json:"tenant_id"`
	Host            string    `json:"host"`
	UpstreamService string    `json:"upstream_service"`
	UpstreamPort    int       `json:"upstream_port"`
	CreatedAt       time.Time `json:"created_at,omitempty"`
	UpdatedAt       time.Time `json:"updated_at,omitempty"`
}

type Client struct {
	db *sql.DB
}

func NewClient(connStr string) (*Client, error) {
	db, err := sql.Open("postgres", connStr)
	if err != nil {
		return nil, fmt.Errorf("failed to open database: %w", err)
	}

	for i := 0; i < 15; i++ {
		if err = db.Ping(); err == nil {
			break
		}
		time.Sleep(1 * time.Second)
	}
	if err != nil {
		return nil, fmt.Errorf("could not connect to postgres: %w", err)
	}

	if err := runMigrations(db); err != nil {
		return nil, fmt.Errorf("migration failed: %w", err)
	}

	return &Client{db: db}, nil
}

func runMigrations(db *sql.DB) error {
	driver, err := postgres.WithInstance(db, &postgres.Config{})
	if err != nil {
		return err
	}

	sourceDriver, err := iofs.New(migrationFiles, "migrations")
	if err != nil {
		return err
	}

	m, err := migrate.NewWithInstance("iofs", sourceDriver, "postgres", driver)
	if err != nil {
		return err
	}

	log.Println("Applying database migrations...")
	if err := m.Up(); err != nil && !errors.Is(err, migrate.ErrNoChange) {
		return err
	}

	version, _, _ := m.Version()
	log.Printf("Database schema up-to-date (version: %d)\n", version)
	return nil
}

func (c *Client) GetRoutes(ctx context.Context) ([]Route, error) {
	query := `SELECT id, tenant_id, host, upstream_service, upstream_port FROM routes ORDER BY id ASC`
	rows, err := c.db.QueryContext(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var routes []Route
	for rows.Next() {
		var r Route
		if err := rows.Scan(&r.ID, &r.TenantID, &r.Host, &r.UpstreamService, &r.UpstreamPort); err != nil {
			return nil, err
		}
		routes = append(routes, r)
	}
	return routes, nil
}

func (c *Client) CreateRoute(ctx context.Context, r Route) error {
	query := `INSERT INTO routes (tenant_id, host, upstream_service, upstream_port) VALUES ($1, $2, $3, $4)`
	_, err := c.db.ExecContext(ctx, query, r.TenantID, r.Host, r.UpstreamService, r.UpstreamPort)
	return err
}

func (c *Client) DeleteRoute(ctx context.Context, id int) error {
	query := `DELETE FROM routes WHERE id = $1`
	_, err := c.db.ExecContext(ctx, query, id)
	return err
}

func (c *Client) Close() error {
	return c.db.Close()
}
