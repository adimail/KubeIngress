package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"log"
	"net/http"
	"os"
)

var animals = []string{
	"Badger", "Falcon", "Otter", "Panda", "Fox", "Wolf", "Lynx",
	"Hawk", "Viper", "Panther", "Bison", "Raven", "Cobra", "Jaguar",
}

type RequestPayload struct {
	Input string `json:"input"`
}

type Fingerprint struct {
	Color  string `json:"color"`
	Animal string `json:"animal"`
}

type ResponsePayload struct {
	Input       string      `json:"input"`
	SHA256      string      `json:"sha256"`
	Fingerprint Fingerprint `json:"fingerprint"`
	PodName     string      `json:"pod_name"`
}

func main() {
	http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "Method Not Allowed. Send a POST request with JSON body.", http.StatusMethodNotAllowed)
			return
		}

		var req RequestPayload
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Input == "" {
			http.Error(w, "Bad Request: JSON body with 'input' field required", http.StatusBadRequest)
			return
		}

		hash := sha256.Sum256([]byte(req.Input))
		hashHex := hex.EncodeToString(hash[:])

		color := "#" + hashHex[:6]
		animalIdx := int(hash[7]) % len(animals)

		podName, _ := os.Hostname()

		resp := ResponsePayload{
			Input:  req.Input,
			SHA256: hashHex,
			Fingerprint: Fingerprint{
				Color:  color,
				Animal: animals[animalIdx],
			},
			PodName: podName,
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(resp)
	})

	log.Println("Enigma service running on port 8080...")
	log.Fatal(http.ListenAndServe(":8080", nil))
}
