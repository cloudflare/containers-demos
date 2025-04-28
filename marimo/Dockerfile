FROM ghcr.io/marimo-team/marimo:latest
COPY ./container /server
# Prod
EXPOSE 8080
# Dev
EXPOSE 8787

# Run
WORKDIR /server
CMD ["marimo", "edit", "--no-token", "-p", "8080", "--host", "0.0.0.0"]
