package entailment

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

type corpusCase struct {
	Expected bool     `json:"expected"`
	Facts    Facts    `json:"facts"`
	Name     string   `json:"name"`
	Source   []string `json:"source"`
	Target   []string `json:"target"`
}

type corpusFile struct {
	SchemaVersion int          `json:"schemaVersion"`
	Cases         []corpusCase `json:"cases"`
}

func TestSharedCorpus(t *testing.T) {
	path := filepath.Join("..", "..", "..", "..", "spec", "entailment-corpus.json")
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var corpus corpusFile
	if err := json.Unmarshal(data, &corpus); err != nil {
		t.Fatal(err)
	}
	if corpus.SchemaVersion != 1 {
		t.Fatalf("schema version: got %d, want 1", corpus.SchemaVersion)
	}
	for _, entry := range corpus.Cases {
		t.Run(entry.Name, func(t *testing.T) {
			source, err := ParsePredicates(entry.Source)
			if err != nil {
				t.Fatal(err)
			}
			target, err := ParsePredicates(entry.Target)
			if err != nil {
				t.Fatal(err)
			}
			if actual := Entails(source, target, entry.Facts); actual != entry.Expected {
				t.Fatalf("Entails() = %v, want %v", actual, entry.Expected)
			}
		})
	}
}
