package host

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"

	shimast "github.com/microsoft/typescript-go/shim/ast"

	"github.com/ts-refinement/ttsc-plugin/native/analysis"
)

const (
	refinementManifestFileName      = ".ts-refinement-manifest.json"
	refinementManifestSchemaVersion = 1
	refinementMarkerPrefix          = "ts-refinement-site:"
)

type nativeManifestAsset struct {
	File   string `json:"file"`
	SHA256 string `json:"sha256"`
}

type nativeManifestSite struct {
	ID            string   `json:"id"`
	Length        int      `json:"length"`
	Module        string   `json:"module"`
	PredicateKeys []string `json:"predicateKeys"`
	Start         int      `json:"start"`
}

type nativeManifestCheckIdentity struct {
	Path          []analysis.PathSegment `json:"path"`
	PredicateKeys []string               `json:"predicateKeys"`
}

type nativeManifest struct {
	Assets        []nativeManifestAsset `json:"assets"`
	BuildID       string                `json:"buildId"`
	Project       nativeManifestProject `json:"project"`
	SchemaVersion int                   `json:"schemaVersion"`
	Sites         []nativeManifestSite  `json:"sites"`
}

type nativeManifestProject struct {
	ConfigPath string `json:"configPath"`
}

type nativeBuildTracker struct {
	buildID    string
	configPath string
	sites      map[string]nativeManifestSite
}

func newNativeBuildTracker(cwd, tsconfig string) (*nativeBuildTracker, error) {
	buildID, err := randomUUID()
	if err != nil {
		return nil, err
	}
	configPath := tsconfig
	if !filepath.IsAbs(configPath) {
		configPath = filepath.Join(cwd, configPath)
	}
	return &nativeBuildTracker{
		buildID:    buildID,
		configPath: filepath.Clean(configPath),
		sites:      map[string]nativeManifestSite{},
	}, nil
}

func (tracker *nativeBuildTracker) register(
	file *shimast.SourceFile,
	site assertion,
	checks []analysis.Check,
	recursions []analysis.Recursion,
) string {
	start := tokenStart(file, site.node)
	predicateKeys := []string{}
	checkIdentities := make([]nativeManifestCheckIdentity, 0, len(checks))
	for _, check := range checks {
		checkPredicateKeys := make([]string, 0, len(check.Definition.Predicates))
		for _, predicate := range check.Definition.Predicates {
			key := predicate.Key()
			predicateKeys = append(predicateKeys, key)
			checkPredicateKeys = append(checkPredicateKeys, key)
		}
		checkIdentities = append(checkIdentities, nativeManifestCheckIdentity{
			Path:          check.Path,
			PredicateKeys: checkPredicateKeys,
		})
	}
	module, err := filepath.Rel(filepath.Dir(tracker.configPath), file.FileName())
	if err != nil {
		module = file.FileName()
	}
	identity := struct {
		Checks        []nativeManifestCheckIdentity `json:"checks"`
		Length        int                           `json:"length"`
		Module        string                        `json:"module"`
		PredicateKeys []string                      `json:"predicateKeys"`
		Recursions    []analysis.Recursion          `json:"recursions"`
		Start         int                           `json:"start"`
	}{
		Checks:        checkIdentities,
		Length:        site.node.End() - start,
		Module:        filepath.ToSlash(module),
		PredicateKeys: predicateKeys,
		Recursions:    recursions,
		Start:         start,
	}
	encoded, _ := json.Marshal(identity)
	idBytes := sha256.Sum256(encoded)
	id := hex.EncodeToString(idBytes[:])
	tracker.sites[id] = nativeManifestSite{
		ID:            id,
		Length:        identity.Length,
		Module:        identity.Module,
		PredicateKeys: predicateKeys,
		Start:         start,
	}
	return refinementMarkerPrefix + tracker.buildID + ":" + id
}

func (tracker *nativeBuildTracker) write(
	directory string,
	assets []nativeManifestAsset,
) error {
	sites := make([]nativeManifestSite, 0, len(tracker.sites))
	for _, site := range tracker.sites {
		sites = append(sites, site)
	}
	sort.Slice(sites, func(left, right int) bool {
		if sites[left].Module == sites[right].Module {
			return sites[left].Start < sites[right].Start
		}
		return sites[left].Module < sites[right].Module
	})
	sort.Slice(assets, func(left, right int) bool {
		return assets[left].File < assets[right].File
	})
	manifest := nativeManifest{
		Assets:        assets,
		BuildID:       tracker.buildID,
		Project:       nativeManifestProject{ConfigPath: tracker.configPath},
		SchemaVersion: refinementManifestSchemaVersion,
		Sites:         sites,
	}
	encoded, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		return err
	}
	encoded = append(encoded, '\n')
	if err := os.MkdirAll(directory, 0o755); err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(directory, refinementManifestFileName), encoded, 0o644)
}

func nativeManifestAssetFor(directory, fileName, source string) (nativeManifestAsset, bool) {
	switch filepath.Ext(fileName) {
	case ".cjs", ".js", ".mjs":
	default:
		return nativeManifestAsset{}, false
	}
	relative, err := filepath.Rel(directory, fileName)
	if err != nil {
		return nativeManifestAsset{}, false
	}
	digest := sha256.Sum256([]byte(source))
	return nativeManifestAsset{
		File:   filepath.ToSlash(relative),
		SHA256: hex.EncodeToString(digest[:]),
	}, true
}

func randomUUID() (string, error) {
	value := make([]byte, 16)
	if _, err := rand.Read(value); err != nil {
		return "", fmt.Errorf("generate refinement build ID: %w", err)
	}
	value[6] = (value[6] & 0x0f) | 0x40
	value[8] = (value[8] & 0x3f) | 0x80
	return fmt.Sprintf(
		"%s-%s-%s-%s-%s",
		hex.EncodeToString(value[0:4]),
		hex.EncodeToString(value[4:6]),
		hex.EncodeToString(value[6:8]),
		hex.EncodeToString(value[8:10]),
		hex.EncodeToString(value[10:16]),
	), nil
}
