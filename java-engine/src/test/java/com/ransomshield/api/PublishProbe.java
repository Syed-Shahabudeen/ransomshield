package com.ransomshield.api;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.ransomshield.model.AlertPayload;

import java.util.List;

public class PublishProbe {
    public static void main(String[] args) throws Exception {
        String url = args.length > 0 ? args[0] : "http://127.0.0.1:8000";
        AlertPayload p = new AlertPayload();
        p.timestamp = System.currentTimeMillis();
        p.filepath = "probe.txt";
        p.department = "root";
        p.entropy = 0.0;
        p.threatScore = 5;
        p.filesAffected = 1;
        p.reasons = List.of("probe");
        p.pidChain = List.of();
        p.freezeResults = List.of();
        String json = new ObjectMapper().writeValueAsString(p);
        System.out.println("JSON=" + json);
        boolean ok = new AlertPublisher(url).publish(p);
        System.out.println("RESULT=" + ok);
    }
}
