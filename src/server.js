const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 5000;
const DB = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "seed.json"), "utf8"));

app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "..", "public")));

const state = {
  plans: [],
  scenarios: []
};

const money = (n) => Math.round(Number(n || 0) * 100) / 100;

function getPort(name) {
  return DB.ports.find(p => p.name.toLowerCase() === String(name || "").toLowerCase());
}

function forecast(country = "IN") {
  const port = DB.ports[0];
  const base = 22 + ((country.charCodeAt(0) || 73) % 7);
  const congestionFactor = 1 + port.congestion / 1000;
  return Array.from({length: 8}, (_, i) =>
    money(base * congestionFactor * (1 + i * 0.015))
  );
}

function compatibleVessels(qty, port, preferred) {
  return DB.vessels
    .filter(v => {
      const cargoFit = v.capacity >= Math.min(Number(qty), 150000);
      const physicalFit = v.draft <= port.draft && v.loa <= port.loa && v.beam <= port.beam;
      const preferenceFit = !preferred || preferred === "Any feasible class" || v.type.toLowerCase() === preferred.toLowerCase();
      return cargoFit && physicalFit && preferenceFit;
    })
    .sort((a,b) => a.rate - b.rate);
}

app.get("/api/health", (req,res) => {
  res.json({ ok:true, service:"CONVERRA API", version:"1.0.0", timestamp:new Date().toISOString() });
});

app.get("/api/meta", (req,res) => {
  res.json({
    countries: DB.countries,
    ports: DB.ports,
    vessels: DB.vessels,
    origins: DB.origins
  });
});

app.get("/api/ports", (req,res) => res.json(DB.ports));
app.get("/api/vessels", (req,res) => res.json(DB.vessels));

app.get("/api/forecast", (req,res) => {
  const country = req.query.country || "IN";
  const values = forecast(country);
  const end = values.at(-1);
  const port = DB.ports[0];
  res.json({
    country,
    horizonDays: 90,
    pointForecast: end,
    range: [money(end * .93), money(end * 1.07)],
    uncertainty: port.congestion > 55 ? "High" : port.congestion > 40 ? "Medium" : "Low",
    trend: end > values[0] ? "Increasing" : "Stable",
    values,
    drivers: [
      {name:"Historical freight trend", weight:31},
      {name:"Commodity price", weight:24},
      {name:"Port congestion", weight:18},
      {name:"Seasonality", weight:14},
      {name:"Vessel availability", weight:9}
    ],
    demo:true
  });
});

app.get("/api/fuel", (req,res) => {
  const country = req.query.country || "IN";
  const base = DB.fuel[country] || 720;
  const values = [.96,.98,1,1.015,1.035,1.06,1.075,1.09].map(x => money(base*x));
  res.json({
    country,
    current: values[0],
    day30: values[4],
    day90: values.at(-1),
    trend: values.at(-1) > values[0] ? "Rising" : "Falling",
    sensitivity: values.at(-1) > values[0]*1.08 ? "High" : "Medium",
    values,
    demo:true
  });
});

app.post("/api/plans", (req,res) => {
  const {
    commodity="Coking Coal",
    cargoQty=500000,
    origin="Indonesia",
    originPort,
    destination="Paradip Port",
    deadline,
    procurementPrice=185,
    contract="Let optimizer decide",
    vesselPreference="Any feasible class",
    budget
  } = req.body || {};

  const qty = Number(cargoQty);
  if (!Number.isFinite(qty) || qty < 1000) {
    return res.status(400).json({error:"cargoQty must be at least 1000 MT"});
  }

  const port = getPort(destination) || DB.ports[0];
  const candidates = compatibleVessels(qty, port, vesselPreference);
  if (!candidates.length) {
    return res.status(422).json({
      feasible:false,
      reason:"No vessel satisfies the current cargo and port constraints.",
      suggestions:["Try another port","Allow another vessel class","Extend the delivery window"]
    });
  }

  const vessel = candidates[0];
  const voyages = Math.ceil(qty / vessel.capacity);
  const freight = 20 + Math.max(0, Object.keys(DB.origins).indexOf(origin)) * 1.4;
  const total = money(qty * (Number(procurementPrice) + freight) + port.cost * qty + port.delay * 17000);
  const costPerMt = money(total / qty);

  if (budget && costPerMt > Number(budget)) {
    return res.status(422).json({
      feasible:false,
      reason:`Estimated cost ${costPerMt}/MT exceeds the supplied budget of ${budget}/MT.`,
      estimatedCostPerMt:costPerMt
    });
  }

  const plan = {
    id:`PLAN-${Date.now()}`,
    createdAt:new Date().toISOString(),
    commodity, cargoQty:qty, origin, originPort, destination:port.name,
    deadline:deadline || null, procurementPrice:Number(procurementPrice),
    contract, vesselPreference, vessel, voyages, freight,
    totalCost:total, costPerMt, port, demo:true
  };
  state.plans.unshift(plan);
  res.status(201).json(plan);
});

app.get("/api/plans", (req,res) => res.json(state.plans));

app.post("/api/simulate", (req,res) => {
  const freightChange = Number(req.body.freightChange || 0);
  const congestion = Number(req.body.congestion || 35);
  const delay = Number(req.body.delay || 0);
  const cargoChange = Number(req.body.cargoChange || 0);
  const baseCargo = Number(req.body.baseCargo || 500000);
  const cargo = Math.max(1000, baseCargo + cargoChange);
  const baseRate = 24.5;
  const adjustedRate = baseRate * (1 + freightChange/100) * (1 + congestion/1000);
  const delayCost = delay * 17000;
  const total = money(cargo * adjustedRate + delayCost);
  res.json({
    cargo,
    adjustedRate:money(adjustedRate),
    totalCost:total,
    delayDays:delay,
    congestion,
    freightChange,
    risk: congestion > 70 || delay > 14 ? "High" : congestion > 45 || delay > 7 ? "Medium" : "Low"
  });
});

app.post("/api/counterfactual", (req,res) => {
  const type = req.body.type || "earlier";
  const deltas = {
    earlier:{costPct:-3.2, delay:-2, label:"Charter 14 days earlier"},
    later:{costPct:4.7, delay:3, label:"Charter 14 days later"},
    port:{costPct:-1.8, delay:-1, label:"Use another port"},
    vessel:{costPct:2.4, delay:0, label:"Use another vessel"},
    contract:{costPct:-2.1, delay:0, label:"Use COA"}
  };
  const d = deltas[type] || deltas.earlier;
  const base = Number(req.body.baseCost || 12500000);
  const result = {
    type,
    label:d.label,
    baselineCost:money(base),
    alternativeCost:money(base * (1 + d.costPct/100)),
    costDelta:money(base * d.costPct/100),
    delayDelta:d.delay,
    risk:type === "later" ? "Higher schedule exposure" : "Scenario-dependent",
    demo:true
  };
  state.scenarios.unshift({...result,createdAt:new Date().toISOString()});
  res.json(result);
});

app.post("/api/copilot", (req,res) => {
  const q = String(req.body.question || "").toLowerCase();
  let answer = "I can analyze the current cargo, vessel, port, freight, fuel and scenario context.";
  if (q.includes("vessel")) answer = `There are ${DB.vessels.length} seeded vessel classes. Feasibility is checked against capacity, draft, LOA and beam.`;
  else if (q.includes("risk")) answer = "The main demo risk signals are port congestion, freight uncertainty, fuel exposure and disruption-driven delay.";
  else if (q.includes("charter")) answer = "Charter timing is evaluated against freight, fuel, vessel availability, port feasibility and the delivery context.";
  else if (q.includes("port")) answer = "Port selection considers draft, LOA, beam, congestion, capacity, cost and delay assumptions.";
  else if (q.includes("summar")) answer = "CONVERRA connects cargo procurement, freight/fuel forecasting, vessel feasibility, port constraints, charter strategy and what-if analysis in one planning workflow.";
  res.json({answer, sources:["CONVERRA seeded demo data"],demo:true});
});

app.use((req,res,next) => {
  if (req.method === "GET" && !req.path.startsWith("/api/")) {
    return res.sendFile(path.join(__dirname, "..", "public", "index.html"));
  }
  next();
});

app.use((err,req,res,next) => {
  console.error(err);
  res.status(500).json({error:"Internal server error"});
});

app.listen(PORT, () => {
  console.log(`CONVERRA API running on http://localhost:${PORT}`);
});
