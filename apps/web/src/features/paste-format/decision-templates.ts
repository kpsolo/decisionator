import type { Option } from "@decisionator/core";

export interface DecisionTemplate {
  id: string;
  name: string;
  badge: string;
  icon: string;
  title: string;
  description: string;
  options: Option[];
}

export const DECISION_TEMPLATES: DecisionTemplate[] = [
  {
    id: "offsite",
    name: "Team Offsite",
    badge: "Culture & Team",
    icon: "🏖️",
    title: "Q2 Team Offsite Destination",
    description:
      "Evaluating candidate destinations for our 4-day annual distributed team gathering.",
    options: [
      {
        id: "opt_offsite_lisbon",
        order: 1,
        status: "active",
        title: "Lisbon, Portugal",
        description:
          "Vibrant coastal hub with great co-working spaces, pleasant weather, and convenient transatlantic flight connections.",
        category: "Southern Europe",
        tags: ["Walkable", "Affordable", "Good Weather"],
        pros: [
          "Great food & culture",
          "Affordable lodging & dining",
          "Direct flights for EU & US East",
        ],
        cons: ["Steep hills for walking", "Busy tourist season in spring"],
        links: [{ url: "https://en.wikipedia.org/wiki/Lisbon" }],
      },
      {
        id: "opt_offsite_tokyo",
        order: 2,
        status: "active",
        title: "Tokyo, Japan",
        description:
          "World-class public transit, exceptional cuisine, and unforgettable team cultural experiences.",
        category: "East Asia",
        tags: ["World-Class Transit", "Safety", "Culinary"],
        pros: [
          "Incredible safety & punctuality",
          "Remarkable food and group activities",
          "Strong yen exchange rate",
        ],
        cons: ["Long flight duration for Americas/Europe", "Higher accommodation costs"],
        links: [{ url: "https://en.wikipedia.org/wiki/Tokyo" }],
      },
      {
        id: "opt_offsite_banff",
        order: 3,
        status: "active",
        title: "Banff National Park, Canada",
        description:
          "Stunning mountain retreats, outdoor team bonding, hiking, and tranquil nature.",
        category: "North America",
        tags: ["Nature", "Outdoors", "Scenic"],
        pros: [
          "Breathtaking mountain scenery",
          "Focused retreat environment away from city noise",
          "Hiking & outdoor bonding",
        ],
        cons: ["Weather can be unpredictable", "Requires 1.5 hr shuttle from Calgary airport"],
        links: [{ url: "https://en.wikipedia.org/wiki/Banff_National_Park" }],
      },
      {
        id: "opt_offsite_reykjavik",
        order: 4,
        status: "active",
        title: "Reykjavik, Iceland",
        description:
          "Geothermal springs, dramatic volcanic landscapes, and midway flight stop between North America and Europe.",
        category: "Northern Europe",
        tags: ["Geothermal", "Midway Hub", "Unique"],
        pros: [
          "Fair midpoint for US and European teammates",
          "Unique geothermal and outdoor experiences",
          "High English fluency",
        ],
        cons: ["High food and dining expenses", "Variable weather"],
        links: [{ url: "https://en.wikipedia.org/wiki/Reykjav%C3%ADk" }],
      },
    ],
  },
  {
    id: "database",
    name: "Database Architecture",
    badge: "Technical RFC",
    icon: "💻",
    title: "Next-Gen Database Platform",
    description:
      "Selecting our primary persistence store for upcoming high-throughput multi-tenant workloads.",
    options: [
      {
        id: "opt_db_postgres",
        order: 1,
        status: "active",
        title: "PostgreSQL with Citus / Supabase",
        description:
          "Industry-standard relational model with battle-tested ACID transactions and mature JSONB indexing.",
        category: "Relational",
        tags: ["ACID", "Mature", "SQL"],
        pros: ["Rich ecosystem and extensions", "Robust migration tooling", "Familiar SQL dialect"],
        cons: ["Vertical scaling limits before sharding", "Connection pool tuning required"],
        links: [{ url: "https://www.postgresql.org" }],
      },
      {
        id: "opt_db_dynamodb",
        order: 2,
        status: "active",
        title: "AWS DynamoDB (Single-Table Design)",
        description:
          "Serverless key-value / document store with predictable single-digit millisecond latency at any scale.",
        category: "NoSQL",
        tags: ["Serverless", "Single-Digit ms", "Cloud Native"],
        pros: [
          "Virtually unlimited automatic scale",
          "Zero maintenance overhead",
          "Extremely reliable SLA",
        ],
        cons: ["Steep single-table modeling learning curve", "Complex ad-hoc querying"],
        links: [{ url: "https://aws.amazon.com/dynamodb" }],
      },
      {
        id: "opt_db_turso",
        order: 3,
        status: "active",
        title: "Turso / LibSQL (Edge Replicated)",
        description:
          "Embedded SQLite engine with worldwide edge replication and instant branching.",
        category: "Embedded / Edge",
        tags: ["Edge Replicated", "Microsecond Latency", "SQLite"],
        pros: [
          "Microsecond reads at the edge",
          "Schema branching for PR previews",
          "Extremely lightweight",
        ],
        cons: ["Newer technology stack", "Write-throughput limited to primary region"],
        links: [{ url: "https://turso.tech" }],
      },
    ],
  },
  {
    id: "initiatives",
    name: "Quarterly Priorities",
    badge: "Roadmap",
    icon: "🎯",
    title: "Q3 Engineering Priorities",
    description:
      "Aligning team resources across top candidate initiatives for the next product sprint cycle.",
    options: [
      {
        id: "opt_prio_mobile",
        order: 1,
        status: "active",
        title: "Mobile Web & PWA Experience",
        description:
          "Revamp touch interactions, responsive layouts, and installable PWA offline capabilities.",
        category: "User Experience",
        tags: ["Mobile", "PWA", "Adoption"],
        pros: ["Expands access during meetings and commutes", "Improves overall accessibility"],
        cons: ["Requires thorough cross-browser mobile testing"],
        links: [],
      },
      {
        id: "opt_prio_perf",
        order: 2,
        status: "active",
        title: "End-to-End Latency & Performance",
        description:
          "Optimize client bundle size, virtualize large lists, and reduce cold-start render times.",
        category: "Infrastructure",
        tags: ["Speed", "Core Web Vitals", "Optimization"],
        pros: ["Directly boosts user retention and satisfaction", "Lowers infrastructure cost"],
        cons: ["Less visible to end-users than new features"],
        links: [],
      },
      {
        id: "opt_prio_plugins",
        order: 3,
        status: "active",
        title: "Plugin Marketplace & Developer SDK",
        description:
          "Publish SDK documentation, improve sandbox isolation, and release starter plugins.",
        category: "Platform",
        tags: ["Extensibility", "Developer Experience", "Ecosystem"],
        pros: ["Enables community and enterprise integrations", "Decouples core development"],
        cons: ["Requires maintaining public API compatibility"],
        links: [],
      },
    ],
  },
];
