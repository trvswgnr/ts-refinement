package entailment

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

type corpusCase struct {
	Expected bool              `json:"expected"`
	Facts    Facts             `json:"facts"`
	Name     string            `json:"name"`
	Samples  []json.RawMessage `json:"samples"`
	Source   []string          `json:"source"`
	Target   []string          `json:"target"`
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
			sawCounterexample := false
			for _, sample := range entry.Samples {
				sourceText, supported := corpusSampleSource(sample)
				if !supported {
					continue
				}
				sourceHolds, sourceKnown := predicatesHold(source, sourceText)
				targetHolds, targetKnown := predicatesHold(target, sourceText)
				if !sourceKnown || !targetKnown {
					continue
				}
				if entry.Expected && (!sourceHolds || !targetHolds) {
					t.Fatalf("positive sample %s does not satisfy source and target", sample)
				}
				if !entry.Expected && sourceHolds && !targetHolds {
					sawCounterexample = true
				}
			}
			if !entry.Expected && strings.HasPrefix(entry.Name, "generated number implication ") && !sawCounterexample {
				t.Fatal("negative case has no source-true, target-false sample")
			}
		})
	}
}

func predicatesHold(predicates []Predicate, source string) (bool, bool) {
	for _, predicate := range predicates {
		result, known := Evaluate(predicate, source)
		if !known {
			return false, false
		}
		if !result {
			return false, true
		}
	}
	return true, true
}

func corpusSampleSource(sample json.RawMessage) (string, bool) {
	trimmed := bytes.TrimSpace(sample)
	if len(trimmed) == 0 || bytes.Equal(trimmed, []byte("null")) || trimmed[0] == '[' {
		return "", false
	}
	if trimmed[0] == '{' {
		var encoded struct {
			Kind  string `json:"kind"`
			Value string `json:"value"`
		}
		if json.Unmarshal(trimmed, &encoded) != nil {
			return "", false
		}
		if encoded.Kind == "bigint" {
			return encoded.Value + "n", true
		}
		if encoded.Kind == "number" && (encoded.Value == "NaN" || encoded.Value == "Infinity") {
			return encoded.Value, true
		}
		if encoded.Kind == "number" && encoded.Value == "-Infinity" {
			return "-Infinity", true
		}
		return "", false
	}
	if trimmed[0] == '"' || bytes.Equal(trimmed, []byte("true")) || bytes.Equal(trimmed, []byte("false")) {
		return string(trimmed), true
	}
	number := string(trimmed)
	if strings.ContainsAny(number, "eE") {
		return "", false
	}
	return number, true
}
