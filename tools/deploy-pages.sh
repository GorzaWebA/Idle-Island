#!/usr/bin/env bash
# Publishes the playable game to the gh-pages branch, which GitHub Pages serves at
# https://<owner>.github.io/<repo>/
#
#   tools/deploy-pages.sh ["extra commit message text"]
#
# Only what the game needs (index.html, css/, js/ and the link-preview image) is copied
# into a temporary worktree of gh-pages. It is committed only if something changed, then pushed.
# Set REMOTE or PAGES_BRANCH to override origin / gh-pages.
set -euo pipefail

root=$(git rev-parse --show-toplevel)
cd "$root"
remote=${REMOTE:-origin}
branch=${PAGES_BRANCH:-gh-pages}
rev=$(git rev-parse --short HEAD)
if [ -n "$(git status --porcelain -- index.html css js assets/og.png)" ]; then
  echo "Note: deploying uncommitted changes in the game files (on top of $rev)."
fi

work=$(mktemp -d)
cleanup() { git worktree remove --force "$work" >/dev/null 2>&1 || true; rm -rf "$work"; }
trap cleanup EXIT

if git ls-remote --exit-code --heads "$remote" "$branch" >/dev/null 2>&1; then
  git fetch -q "$remote" "$branch"
  git worktree add -q -B "$branch" "$work" FETCH_HEAD
else
  git worktree add -q --detach "$work"
  git -C "$work" checkout -q --orphan "$branch"
fi

# Replace the site with a fresh copy of the game.
git -C "$work" rm -rq --ignore-unmatch .
find "$work" -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +
cp index.html "$work/"
cp -R css js "$work/"
mkdir -p "$work/assets"
cp assets/og.png "$work/assets/"
touch "$work/.nojekyll"

git -C "$work" add -A
if git -C "$work" diff --cached --quiet; then
  echo "$branch already matches $rev; nothing to deploy."
  exit 0
fi
msg="Deploy $rev to GitHub Pages"
if [ $# -gt 0 ]; then msg="$msg"$'\n\n'"$1"; fi
git -C "$work" commit -q -m "$msg"
git -C "$work" push -q "$remote" "$branch"

url=$(git remote get-url "$remote" | sed -E 's#(git@|https://)github.com[:/]##; s#\.git$##')
owner=${url%%/*}; repo=${url##*/}
echo "Pushed $branch ($rev). It should be live in a minute or two at:"
echo "  https://$(echo "$owner" | tr '[:upper:]' '[:lower:]').github.io/$repo/"
