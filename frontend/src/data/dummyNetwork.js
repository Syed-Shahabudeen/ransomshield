export const initialDemoNetwork = {
  source_node_id: "HOSP-001",
  nodes: [
    { id: "HOSP-001", name: "AIIMS Delhi", region: "north", lat: 28.56, lon: 77.20, beds: 1500, status: "protected", monitored: true, intel_count: 0 },
    { id: "HOSP-002", name: "Apollo Chennai", region: "south", lat: 13.08, lon: 80.27, beds: 1200, status: "protected", monitored: false, intel_count: 0 },
    { id: "HOSP-003", name: "Fortis Bangalore", region: "south", lat: 12.97, lon: 77.59, beds: 900, status: "protected", monitored: false, intel_count: 0 },
    { id: "HOSP-004", name: "Tata Memorial Mumbai", region: "west", lat: 19.07, lon: 72.87, beds: 1100, status: "protected", monitored: false, intel_count: 0 },
    { id: "HOSP-005", name: "CMC Vellore", region: "south", lat: 12.91, lon: 79.13, beds: 1800, status: "protected", monitored: false, intel_count: 0 },
    { id: "HOSP-006", name: "PGIMER Chandigarh", region: "north", lat: 30.76, lon: 76.77, beds: 1400, status: "protected", monitored: false, intel_count: 0 },
    { id: "HOSP-007", name: "KEM Hospital Pune", region: "west", lat: 18.52, lon: 73.85, beds: 800, status: "protected", monitored: false, intel_count: 0 },
    { id: "HOSP-008", name: "Medanta Gurugram", region: "north", lat: 28.45, lon: 77.02, beds: 1000, status: "protected", monitored: false, intel_count: 0 },
    { id: "HOSP-009", name: "Narayana Health", region: "south", lat: 12.80, lon: 77.68, beds: 600, status: "protected", monitored: false, intel_count: 0 },
    { id: "HOSP-010", name: "Lilavati Hospital", region: "west", lat: 19.05, lon: 72.82, beds: 500, status: "protected", monitored: false, intel_count: 0 },
    { id: "HOSP-011", name: "AMRI Hospital Kolkata", region: "east", lat: 22.57, lon: 88.36, beds: 750, status: "protected", monitored: false, intel_count: 0 },
    { id: "HOSP-012", name: "Sankara Nethralaya", region: "south", lat: 13.06, lon: 80.24, beds: 400, status: "protected", monitored: false, intel_count: 0 },
  ],
  counts: { protected: 12, attacked: 0, quarantined: 0, recovered: 0 },
  broadcasts: [],
  events: [],
  campaign: {
    active: false,
    started_at: null,
    acts: []
  }
};

export const createDemoCampaign = () => {
  const now = Math.floor(Date.now() / 1000);
  return {
    active: true,
    started_at: now,
    acts: [
      {
        index: 0,
        at: 2,
        targets: ["west"],
        hits: ["HOSP-004", "HOSP-007"],
        fired: false,
      },
      {
        index: 1,
        at: 5,
        targets: ["south"],
        hits: ["HOSP-002", "HOSP-003", "HOSP-005"],
        fired: false,
      },
      {
        index: 2,
        at: 9,
        targets: ["east", "north"],
        hits: ["HOSP-011", "HOSP-008"],
        fired: false,
      }
    ]
  };
};
