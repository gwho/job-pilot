# Apify actor Docker image — uses the official Playwright+Node base
FROM apify/actor-node-playwright-chrome:20

# Copy only package.json (not the lock file) — the base image runs as a
# non-root user (myuser) and cannot write to a lock file owned by root.
COPY package.json ./
RUN npm install --include=dev

# Copy actor source
COPY . ./

# Run the actor
CMD npm start
