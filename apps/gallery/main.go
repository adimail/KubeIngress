package main

import (
	"html/template"
	"log"
	"net/http"
	"os"
)

type PageData struct {
	PodName  string
	PodIP    string
	NodeName string
}

func main() {
	http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		tmpl, err := template.ParseFiles("index.html")
		if err != nil {
			http.Error(w, "Failed to load template: "+err.Error(), http.StatusInternalServerError)
			return
		}

		data := PageData{
			PodName:  getEnv("POD_NAME", "local-dev"),
			PodIP:    getEnv("POD_IP", "127.0.0.1"),
			NodeName: getEnv("NODE_NAME", "local-node"),
		}

		tmpl.Execute(w, data)
	})

	log.Println("Gallery service running on port 8080...")
	log.Fatal(http.ListenAndServe(":8080", nil))
}

func getEnv(key, fallback string) string {
	if val := os.Getenv(key); val != "" {
		return val
	}
	return fallback
}
