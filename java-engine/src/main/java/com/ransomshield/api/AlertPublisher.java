package com.ransomshield.api;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.ransomshield.model.AlertPayload;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;

/**
 * Hands alert payloads to the FastAPI orchestration layer at
 * POST /api/v1/alert. Pure JDK HTTP client — no extra dependency.
 */
public class AlertPublisher {
    private final String backendBaseUrl;
    private final HttpClient client;
    private final ObjectMapper mapper = new ObjectMapper();

    public AlertPublisher(String backendBaseUrl) {
        this.backendBaseUrl = backendBaseUrl.endsWith("/")
                ? backendBaseUrl.substring(0, backendBaseUrl.length() - 1)
                : backendBaseUrl;
        // HTTP_1_1 is deliberate: the JDK client otherwise sends an h2c
        // (HTTP/2 cleartext) upgrade header on plain HTTP, which h11/uvicorn
        // treats as a connection upgrade and never parses the request body
        // — FastAPI then rejects the alert with 422 "missing body".
        this.client = HttpClient.newBuilder()
                .version(HttpClient.Version.HTTP_1_1)
                .connectTimeout(Duration.ofSeconds(3))
                .build();
    }

    /** POST the payload; returns true on HTTP 2xx. Never throws. */
    public boolean publish(AlertPayload payload) {
        try {
            String json = mapper.writeValueAsString(payload);
            HttpRequest request = HttpRequest.newBuilder()
                    .uri(URI.create(backendBaseUrl + "/api/v1/alert"))
                    .timeout(Duration.ofSeconds(8))
                    .header("Content-Type", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofString(json))
                    .build();
            HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() / 100 == 2) {
                System.out.println("[ENGINE] alert delivered (" + response.statusCode() + "): "
                        + response.body().substring(0, Math.min(120, response.body().length())));
                return true;
            }
            System.err.println("[ENGINE] alert rejected: HTTP " + response.statusCode() + " " + response.body());
        } catch (Exception e) {
            System.err.println("[ENGINE] alert delivery failed: " + e);
        }
        return false;
    }
}
