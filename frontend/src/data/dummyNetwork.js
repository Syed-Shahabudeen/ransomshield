export const initialDemoNetwork = {
  source_node_id: "hq-delhi",
  nodes: [
    { id: "hq-delhi", name: "AIIMS Delhi (Monitored)", city: "New Delhi", state: "Delhi", region: "north", lat: 28.61, lon: 77.21, beds: 2400, tier: 1, security: 93, status: "protected", monitored: true, intel_count: 0 },
    { id: "pgimer-chd", name: "PGIMER Chandigarh", city: "Chandigarh", state: "Chandigarh", region: "north", lat: 30.74, lon: 76.77, beds: 1800, tier: 1, security: 88, status: "protected", monitored: false, intel_count: 0 },
    { id: "sgpgi-lko", name: "SGPGIMS Lucknow", city: "Lucknow", state: "Uttar Pradesh", region: "north", lat: 26.85, lon: 80.94, beds: 950, tier: 1, security: 86, status: "protected", monitored: false, intel_count: 0 },
    { id: "sms-jaipur", name: "SMS Jaipur", city: "Jaipur", state: "Rajasthan", region: "north", lat: 26.90, lon: 75.80, beds: 1200, tier: 1, security: 84, status: "protected", monitored: false, intel_count: 0 },
    { id: "fortis-noida", name: "Fortis Noida", city: "Noida", state: "Uttar Pradesh", region: "north", lat: 28.57, lon: 77.32, beds: 420, tier: 2, security: 80, status: "protected", monitored: false, intel_count: 0 },
    { id: "dist-karnal", name: "District Hospital Karnal", city: "Karnal", state: "Haryana", region: "north", lat: 29.69, lon: 76.98, beds: 350, tier: 3, security: 64, status: "protected", monitored: false, intel_count: 0 },
    { id: "aims-jodhpur", name: "AIIMS Jodhpur", city: "Jodhpur", state: "Rajasthan", region: "west", lat: 26.24, lon: 73.03, beds: 960, tier: 1, security: 85, status: "protected", monitored: false, intel_count: 0 },
    { id: "kem-mum", name: "KEM Hospital Mumbai", city: "Mumbai", state: "Maharashtra", region: "west", lat: 19.01, lon: 72.84, beds: 1800, tier: 1, security: 87, status: "protected", monitored: false, intel_count: 0 },
    { id: "civil-ahm", name: "Civil Hospital Ahmedabad", city: "Ahmedabad", state: "Gujarat", region: "west", lat: 23.03, lon: 72.57, beds: 750, tier: 1, security: 82, status: "protected", monitored: false, intel_count: 0 },
    { id: "nair-mum", name: "Nair Hospital Mumbai", city: "Mumbai", state: "Maharashtra", region: "west", lat: 18.97, lon: 72.83, beds: 620, tier: 2, security: 74, status: "protected", monitored: false, intel_count: 0 },
    { id: "gh-surat", name: "Civil Surat", city: "Surat", state: "Gujarat", region: "west", lat: 21.17, lon: 72.83, beds: 480, tier: 2, security: 72, status: "protected", monitored: false, intel_count: 0 },
    { id: "aims-bhopal", name: "AIIMS Bhopal", city: "Bhopal", state: "Madhya Pradesh", region: "central", lat: 23.20, lon: 77.43, beds: 900, tier: 1, security: 84, status: "protected", monitored: false, intel_count: 0 },
    { id: "aims-raipur", name: "AIIMS Raipur", city: "Raipur", state: "Chhattisgarh", region: "central", lat: 21.23, lon: 81.63, beds: 750, tier: 1, security: 83, status: "protected", monitored: false, intel_count: 0 },
    { id: "jnmc-wardha", name: "JNMC Wardha", city: "Wardha", state: "Maharashtra", region: "central", lat: 20.90, lon: 78.87, beds: 800, tier: 2, security: 76, status: "protected", monitored: false, intel_count: 0 },
    { id: "nims-hyd", name: "NIMS Hyderabad", city: "Hyderabad", state: "Telangana", region: "south", lat: 17.41, lon: 78.47, beds: 1400, tier: 1, security: 86, status: "protected", monitored: false, intel_count: 0 },
    { id: "kims-blr", name: "KIMS Bengaluru", city: "Bengaluru", state: "Karnataka", region: "south", lat: 12.94, lon: 77.61, beds: 1100, tier: 1, security: 85, status: "protected", monitored: false, intel_count: 0 },
    { id: "cmc-vellore", name: "CMC Vellore", city: "Vellore", state: "Tamil Nadu", region: "south", lat: 12.92, lon: 79.13, beds: 2200, tier: 1, security: 90, status: "protected", monitored: false, intel_count: 0 },
    { id: "apollo-chennai", name: "Apollo Chennai", city: "Chennai", state: "Tamil Nadu", region: "south", lat: 13.06, lon: 80.24, beds: 700, tier: 1, security: 84, status: "protected", monitored: false, intel_count: 0 },
    { id: "amrita-kochi", name: "Amrita Kochi", city: "Kochi", state: "Kerala", region: "south", lat: 10.03, lon: 76.29, beds: 900, tier: 1, security: 85, status: "protected", monitored: false, intel_count: 0 },
    { id: "ggh-vijay", name: "Guntur General Hospital", city: "Vijayawada", state: "Andhra Pradesh", region: "south", lat: 16.51, lon: 80.65, beds: 620, tier: 2, security: 71, status: "protected", monitored: false, intel_count: 0 },
    { id: "sskm-kolkata", name: "SSKM Kolkata", city: "Kolkata", state: "West Bengal", region: "east", lat: 22.54, lon: 88.35, beds: 1900, tier: 1, security: 87, status: "protected", monitored: false, intel_count: 0 },
    { id: "aims-patna", name: "AIIMS Patna", city: "Patna", state: "Bihar", region: "east", lat: 25.59, lon: 85.14, beds: 1000, tier: 1, security: 85, status: "protected", monitored: false, intel_count: 0 },
    { id: "aims-bbsr", name: "AIIMS Bhubaneswar", city: "Bhubaneswar", state: "Odisha", region: "east", lat: 20.26, lon: 85.82, beds: 800, tier: 1, security: 84, status: "protected", monitored: false, intel_count: 0 },
    { id: "gimsr-vizag", name: "GIMSR Visakhapatnam", city: "Visakhapatnam", state: "Andhra Pradesh", region: "east", lat: 17.69, lon: 83.21, beds: 540, tier: 2, security: 73, status: "protected", monitored: false, intel_count: 0 },
    { id: "gmch-guwahati", name: "GMCH Guwahati", city: "Guwahati", state: "Assam", region: "northeast", lat: 26.14, lon: 91.74, beds: 900, tier: 1, security: 82, status: "protected", monitored: false, intel_count: 0 },
    { id: "rims-imphal", name: "RIMS Imphal", city: "Imphal", state: "Manipur", region: "northeast", lat: 24.81, lon: 93.94, beds: 700, tier: 2, security: 70, status: "protected", monitored: false, intel_count: 0 },
    { id: "aims-dibrugarh", name: "AIIMS Dibrugarh", city: "Dibrugarh", state: "Assam", region: "northeast", lat: 27.47, lon: 94.91, beds: 550, tier: 2, security: 71, status: "protected", monitored: false, intel_count: 0 },
    { id: "jln-shillong", name: "JLN Shillong", city: "Shillong", state: "Meghalaya", region: "northeast", lat: 25.57, lon: 91.88, beds: 480, tier: 2, security: 68, status: "protected", monitored: false, intel_count: 0 },
  ],
  counts: { protected: 28, attacked: 0, quarantined: 0, recovered: 0 },
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
        hits: ["kem-mum", "aims-jodhpur"],
        fired: false,
      },
      {
        index: 1,
        at: 5,
        targets: ["south"],
        hits: ["apollo-chennai", "kims-blr", "cmc-vellore"],
        fired: false,
      },
      {
        index: 2,
        at: 9,
        targets: ["east", "north"],
        hits: ["sskm-kolkata", "fortis-noida"],
        fired: false,
      }
    ]
  };
};
