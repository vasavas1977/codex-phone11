#!/usr/bin/env sh
set -eu

SOURCE_REPO="${FREESWITCH_DOCS_REPO:-https://github.com/signalwire/freeswitch-docs.git}"
SOURCE_REF="${FREESWITCH_DOCS_REF:-main}"
SKILL_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
DEST="$SKILL_DIR/references/freeswitch-docs"
WORKDIR="${TMPDIR:-/tmp}/freeswitch-docs-sync"
CHECK_ONLY=0

if [ "${1:-}" = "--check" ]; then
  CHECK_ONLY=1
fi

need() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "missing required command: $1" >&2
    exit 127
  fi
}

need git
need awk
need find
need sort
need sed
need wc
need date

copy_markdown_tree() {
  src="$1"
  dst="$2"
  rm -rf "$dst"
  mkdir -p "$dst"
  git -C "$src" ls-files '*.md' '*.mdx' | while IFS= read -r path; do
    dir="${path%/*}"
    if [ "$dir" != "$path" ]; then
      mkdir -p "$dst/$dir"
    fi
    cp "$src/$path" "$dst/$path"
  done
}

public_url_for_doc() {
  path="$1"
  slug="$(awk '
    NR == 1 && $0 == "---" { frontmatter = 1; next }
    frontmatter && $0 == "---" { exit }
    frontmatter && /^slug:[[:space:]]*/ {
      sub(/^slug:[[:space:]]*/, "")
      gsub(/^["'"'"']|["'"'"']$/, "")
      print
      exit
    }
  ' "$WORKDIR/$path")"

  if [ -n "$slug" ]; then
    case "$slug" in
      /*) rel="${slug#/}" ;;
      *)
        rel_path="${path#docs/}"
        doc_dir="${rel_path%/*}"
        case "$rel_path" in
          */index.md|*/index.mdx) parent_dir="${doc_dir%/*}" ;;
          *) parent_dir="$doc_dir" ;;
        esac
        if [ "$parent_dir" = "$doc_dir" ] && [ "$rel_path" = "$doc_dir" ]; then
          parent_dir=""
        fi
        if [ -n "$parent_dir" ] && [ "$parent_dir" != "$doc_dir" ]; then
          rel="$parent_dir/$slug"
        elif [ -n "$parent_dir" ]; then
          rel="$parent_dir/$slug"
        else
          rel="$slug"
        fi
        ;;
    esac
  else
    rel="${path#docs/}"
    rel="${rel%.mdx}"
    rel="${rel%.md}"
  fi
  rel="$(printf '%s' "$rel" | sed 's#/index$#/#')"
  case "$rel" in
    */) printf 'https://developer.signalwire.com/freeswitch/%s\n' "$rel" ;;
    *) printf 'https://developer.signalwire.com/freeswitch/%s/\n' "$rel" ;;
  esac
}

blob_url_for_path() {
  commit="$1"
  path="$2"
  printf 'https://github.com/signalwire/freeswitch-docs/blob/%s/%s\n' "$commit" "$path"
}

detect_latest_tag() {
  git ls-remote --tags --sort='v:refname' https://github.com/signalwire/freeswitch.git 'v*' 2>/dev/null \
    | awk -F/ '/refs\/tags\/v[0-9]+[.][0-9]+[.][0-9]+$/ {print $NF}' \
    | tail -1 || true
}

detect_branch_ref() {
  branch="$1"
  git ls-remote --heads https://github.com/signalwire/freeswitch.git "$branch" 2>/dev/null \
    | awk '{print $1}' || true
}

mkdir -p "$WORKDIR"
if [ -d "$WORKDIR/.git" ]; then
  git -C "$WORKDIR" fetch --tags --prune origin
else
  rm -rf "$WORKDIR"
  git clone "$SOURCE_REPO" "$WORKDIR"
fi

git -C "$WORKDIR" checkout --force "$SOURCE_REF"
git -C "$WORKDIR" submodule update --init --recursive

COMMIT="$(git -C "$WORKDIR" rev-parse HEAD)"
COMMIT_DATE="$(git -C "$WORKDIR" log -1 --format=%cI)"
COMMIT_SUBJECT="$(git -C "$WORKDIR" log -1 --format=%s)"
SYNCED_AT="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
DOC_COUNT="$(git -C "$WORKDIR" ls-files 'docs/*.md' 'docs/*.mdx' | wc -l | awk '{print $1}')"
ALL_MD_COUNT="$(git -C "$WORKDIR" ls-files '*.md' '*.mdx' | wc -l | awk '{print $1}')"
LATEST_TAG="$(detect_latest_tag)"
V110_REF="$(detect_branch_ref v1.10)"
V111_REF="$(detect_branch_ref v1.11)"
MASTER_REF="$(detect_branch_ref master)"

if [ "$CHECK_ONLY" -eq 0 ]; then
  mkdir -p "$(dirname "$DEST")"
  copy_markdown_tree "$WORKDIR" "$DEST"
else
  if [ ! -d "$DEST/docs" ]; then
    echo "mirror missing: $DEST/docs" >&2
    exit 1
  fi
fi

mkdir -p "$DEST"

if [ "$CHECK_ONLY" -eq 1 ]; then
  MANIFEST_TMP="$WORKDIR/MANIFEST.md.check"
  SOURCE_TMP="$WORKDIR/SOURCE.md.check"
else
  MANIFEST_TMP="$DEST/MANIFEST.md.tmp"
  SOURCE_TMP="$DEST/SOURCE.md.tmp"
fi

{
  printf '# FreeSWITCH Docs Manifest\n\n'
  printf '| Local path | Public URL | GitHub source |\n'
  printf '| --- | --- | --- |\n'
  git -C "$WORKDIR" ls-files 'docs/*.md' 'docs/*.mdx' | sort | while IFS= read -r path; do
    printf '| `%s` | <%s> | <%s> |\n' \
      "$path" \
      "$(public_url_for_doc "$path")" \
      "$(blob_url_for_path "$COMMIT" "$path")"
  done
} > "$MANIFEST_TMP"

{
  printf '# FreeSWITCH Docs Source\n\n'
  printf '%s\n' '- Public docs: https://developer.signalwire.com/freeswitch/'
  printf '%s\n' "- Source repo: $SOURCE_REPO"
  printf '%s\n' "- Source ref requested: \`$SOURCE_REF\`"
  printf '%s\n' "- Source commit: \`$COMMIT\`"
  printf '%s\n' "- Source commit date: \`$COMMIT_DATE\`"
  printf '%s\n' "- Source commit subject: $COMMIT_SUBJECT"
  printf '%s\n' "- Synced at UTC: \`$SYNCED_AT\`"
  printf '%s\n' '- Docusaurus baseUrl: `/freeswitch/`'
  printf '%s\n' "- Markdown docs under \`docs/\`: \`$DOC_COUNT\`"
  printf '%s\n' "- All markdown/MDX files in source: \`$ALL_MD_COUNT\`"
  printf '%s\n\n' '- Reference mirror policy: markdown-only (`.md` / `.mdx`); static assets and site build files are not stored in `references/`.'
  printf '## FreeSWITCH Version Scope\n\n'
  printf 'SignalWire does not publish this documentation as a single versioned docs set. This mirror is a source snapshot of the current FreeSWITCH documentation site.\n\n'
  printf '%s\n' "- Latest detected FreeSWITCH git tag: \`${LATEST_TAG:-unknown}\`"
  printf '%s\n' "- FreeSWITCH \`v1.10\` branch ref: \`${V110_REF:-unknown}\`"
  printf '%s\n' "- FreeSWITCH \`v1.11\` branch ref: \`${V111_REF:-unknown}\`"
  printf '%s\n\n' "- FreeSWITCH \`master\` branch ref: \`${MASTER_REF:-unknown}\`"
  printf 'When answering version-specific questions, prefer page-level statements in `docs/` over this broad snapshot metadata.\n'
} > "$SOURCE_TMP"

if [ "$CHECK_ONLY" -eq 0 ]; then
  mv "$MANIFEST_TMP" "$DEST/MANIFEST.md"
  mv "$SOURCE_TMP" "$DEST/SOURCE.md"
  MANIFEST_FILE="$DEST/MANIFEST.md"
else
  if ! cmp -s "$MANIFEST_TMP" "$DEST/MANIFEST.md"; then
    echo "manifest is stale: run ./scripts/sync-freeswitch-docs.sh" >&2
    exit 1
  fi
  MANIFEST_FILE="$MANIFEST_TMP"
fi

LOCAL_DOC_COUNT="$(find "$DEST/docs" -type f \( -name '*.md' -o -name '*.mdx' \) 2>/dev/null | wc -l | awk '{print $1}')"
MANIFEST_COUNT="$(awk '/^\| `docs\// { count++ } END { print count + 0 }' "$MANIFEST_FILE")"
NON_MD_COUNT="$(find "$DEST" -type f ! -name '*.md' ! -name '*.mdx' | wc -l | awk '{print $1}')"

if [ "$DOC_COUNT" != "$LOCAL_DOC_COUNT" ]; then
  echo "doc count mismatch: upstream=$DOC_COUNT local=$LOCAL_DOC_COUNT" >&2
  exit 1
fi

if [ "$DOC_COUNT" != "$MANIFEST_COUNT" ]; then
  echo "manifest count mismatch: upstream=$DOC_COUNT manifest=$MANIFEST_COUNT" >&2
  exit 1
fi

if [ "$NON_MD_COUNT" != "0" ]; then
  echo "non-markdown files found in references: $NON_MD_COUNT" >&2
  find "$DEST" -type f ! -name '*.md' ! -name '*.mdx' | sort >&2
  exit 1
fi

if [ "$CHECK_ONLY" -eq 1 ]; then
  printf 'FreeSWITCH docs verified: %s docs, markdown-only, commit %s\n' "$DOC_COUNT" "$COMMIT"
else
  printf 'FreeSWITCH docs synced: %s docs, markdown-only, commit %s\n' "$DOC_COUNT" "$COMMIT"
fi
