#!/bin/bash
set -e

echo "=== Setting up anonymous git identity for private-pot ==="

# 1. Generate new RSA key (skip if exists)
KEY_FILE="$HOME/.ssh/id_rsa_anon_bot"
if [ ! -f "$KEY_FILE" ]; then
    echo "Generating new RSA key..."
    ssh-keygen -t rsa -b 4096 -C "anon-bot@private" -f "$KEY_FILE" -N ""
else
    echo "Key already exists at $KEY_FILE"
fi

# 2. Initialize git repo
echo "Initializing git repo..."
git init

# 3. Configure anonymous identity (local to this repo only)
echo "Configuring anonymous git identity..."
git config user.name "Anon Bot"
git config user.email "anon-bot@private"

# 4. Add SSH config for GitHub
SSH_CONFIG="$HOME/.ssh/config"
if ! grep -q "Host github-anon" "$SSH_CONFIG" 2>/dev/null; then
    echo "Adding SSH config for github-anon..."
    cat >> "$SSH_CONFIG" << 'EOF'

# Anonymous bot for private-pot
Host github-anon
    HostName github.com
    User git
    IdentityFile ~/.ssh/id_rsa_anon_bot
    IdentitiesOnly yes
EOF
    chmod 600 "$SSH_CONFIG"
else
    echo "SSH config for github-anon already exists"
fi

# 5. Show public key to add to GitHub
echo ""
echo "=== Add this public key to GitHub (https://github.com/settings/keys) ==="
echo ""
cat "$KEY_FILE.pub"
echo ""

# 6. Add files and commit
echo "Adding files and creating first commit..."
git add .
git commit -m "first commit"
git branch -M main

# 7. Add remote using SSH (not HTTPS) with the anon key
echo "Adding remote..."
git remote add origin git@github-anon:YD811/private-pot.git

echo ""
echo "=== Setup complete! ==="
echo ""
echo "Next steps:"
echo "1. Copy the public key above and add it to your GitHub account"
echo "2. Run: git push -u origin main"
