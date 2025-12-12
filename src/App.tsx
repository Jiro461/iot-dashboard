import { useEffect, useMemo, useState } from "react";
import "./App.css";
import { db } from "./firebase";
import { ref, onValue, query, limitToLast } from "firebase/database";

import {
  ResponsiveContainer,
  LineChart,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
} from "recharts";

type TempPoint = {
  id: string;          // pushId
  ts: number;          // unix ms (tự parse từ Time)
  temperature: number; // Temp
  hum?: number;        // Hum (optional)
  stt?: number;        // STT (optional)
  timeStr?: string;    // Time (raw)
};

type TabKey = "live" | "history";

const SENSOR_DATA_PATH = "sensor_data";

const CHART_MAX_POINTS = 120;

const BUCKET_MINUTES = 1;
const PAGE_SIZE = 10;

const BUCKET_MS = BUCKET_MINUTES * 60 * 1000;
const bucketEnd = (bucket: number) => bucket + BUCKET_MS - 1;

const MAX_FETCH = 1500;

function fmtTime(ts: number) {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
function fmtDateTime(ts: number) {
  const d = new Date(ts);
  return d.toLocaleString();
}
function bucketStart(ts: number, bucketMinutes: number) {
  const size = bucketMinutes * 60 * 1000;
  return Math.floor(ts / size) * size;
}

function safeNumber(v: any): number | null {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return null;
  return n;
}

function parseTimeDDMMYYYY(s?: string): number | null {
  if (!s || typeof s !== "string") return null;
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2}):(\d{2})$/);
  if (!m) return null;
  const dd = Number(m[1]);
  const MM = Number(m[2]);
  const yyyy = Number(m[3]);
  const hh = Number(m[4]);
  const mm = Number(m[5]);
  const ss = Number(m[6]);
  const d = new Date(yyyy, MM - 1, dd, hh, mm, ss);
  const ts = d.getTime();
  return Number.isFinite(ts) ? ts : null;
}

function mapCRecordToPoint(id: string, v: any): TempPoint | null {
  const temperature = safeNumber(v?.Temp);
  if (temperature == null) return null;

  const hum = safeNumber(v?.Hum) ?? undefined;
  const stt = safeNumber(v?.STT) ?? undefined;

  const timeStr = typeof v?.Time === "string" ? v.Time : undefined;
  let ts = parseTimeDDMMYYYY(timeStr);

  if (ts == null) ts = Date.now();

  return { id, ts, temperature, hum, stt, timeStr };
}

export default function App() {
  const [tab, setTab] = useState<TabKey>("live");
  const [connected, setConnected] = useState(false);
  const [err, setErr] = useState("");
  const [points, setPoints] = useState<TempPoint[]>([]);
  const [page, setPage] = useState(1);

  useEffect(() => {
    setErr("");
    setPoints([]);
    setPage(1);

    const q = query(ref(db, SENSOR_DATA_PATH), limitToLast(MAX_FETCH));
    const unsub = onValue(
      q,
      (snap) => {
        setConnected(true);

        if (!snap.exists()) {
          setPoints([]);
          return;
        }

        const raw = snap.val() as Record<string, any>;
        const next: TempPoint[] = [];

        for (const [id, v] of Object.entries(raw)) {
          const p = mapCRecordToPoint(id, v);
          if (p) next.push(p);
        }

        next.sort((a, b) => a.ts - b.ts);
        setPoints(next);
      },
      (e) => {
        setConnected(false);
        setErr(String(e));
      }
    );

    return () => unsub();
  }, []);

  const chartData = useMemo(() => {
    const last = points.slice(Math.max(0, points.length - CHART_MAX_POINTS));
    return last.map((p) => ({
      ts: p.ts,
      time: fmtTime(p.ts),
      temperature: p.temperature,
    }));
  }, [points]);

  const currentPoint = points.length ? points[points.length - 1] : null;

  const historyBuckets = useMemo(() => {
    const map = new Map<number, TempPoint>();
    for (const p of points) {
      const b = bucketStart(p.ts, BUCKET_MINUTES);
      const exist = map.get(b);
      if (!exist || p.ts >= exist.ts) map.set(b, p);
    }
    return Array.from(map.entries())
      .map(([bucket, p]) => ({ bucket, ...p }))
      .sort((a, b) => b.bucket - a.bucket);
  }, [points]);

  const totalPages = Math.max(1, Math.ceil(historyBuckets.length / PAGE_SIZE));
  const pageSafe = Math.min(Math.max(1, page), totalPages);
  const pageRows = historyBuckets.slice((pageSafe - 1) * PAGE_SIZE, pageSafe * PAGE_SIZE);

  // Khi đổi tab/history, nếu page vượt totalPages thì kéo về cho sạch
  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  return (
    <div className="container">
      <div className="topbar">
        <div className="brand">
          <div className="logo" />
          <div style={{ minWidth: 0 }}>
            <h1>IoT Temperature Dashboard</h1>
            <p>Data: /sensor_data (C-style POST records)</p>
          </div>
        </div>

        <div className="pill" title="Realtime DB connection">
          <span className="dot" style={{ opacity: connected ? 1 : 0.3 }} />
          {connected ? "DB Connected" : "DB Not Connected"}
        </div>
      </div>

      <div className="tabs">
        <button className={"tabbtn " + (tab === "live" ? "active" : "")} onClick={() => setTab("live")}>
          Live
        </button>
        <button className={"tabbtn " + (tab === "history" ? "active" : "")} onClick={() => setTab("history")}>
          Lịch sử
        </button>
      </div>

      {err && (
        <div className="card" style={{ marginBottom: 12 }}>
          <div className="cardBody" style={{ color: "#ffb3b3" }}>
            <b>Error:</b> {err}
          </div>
        </div>
      )}

      {tab === "live" ? (
        <div className="grid">
          <div className="card">
            <div className="cardHeader">
              <div>
                <h2>Realtime Temperature (chart)</h2>
                <p className="sub">
                  {points.length
                    ? `Đang hiển thị ${Math.min(CHART_MAX_POINTS, points.length)} điểm gần nhất / Tổng: ${points.length}`
                    : "Chưa có dữ liệu trong /sensor_data"}
                </p>
              </div>
              <span className="badge">{BUCKET_MINUTES}m buckets</span>
            </div>
            {/*Đây là phần biểu đồ*/}
            <div className="chartWrap">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData}>
                  <CartesianGrid stroke="rgba(255,255,255,0.08)" />
                  <XAxis dataKey="time" stroke="rgba(255,255,255,0.55)" tick={{ fontSize: 12 }} />
                  <YAxis stroke="rgba(255,255,255,0.55)" tick={{ fontSize: 12 }} domain={["auto", "auto"]} />
                  <Tooltip
                    contentStyle={{
                      background: "rgba(15,16,20,0.95)",
                      border: "1px solid rgba(245,197,66,0.25)",
                      borderRadius: 12,
                      color: "white",
                    }}
                    labelStyle={{ color: "rgba(245,197,66,0.95)" }}
                    formatter={(value: any) => [`${Number(value).toFixed(2)} °C`, "Temp"]}
                    labelFormatter={(_, payload: any) => {
                      const ts = payload?.[0]?.payload?.ts;
                      return ts ? fmtDateTime(ts) : "";
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="temperature"
                    stroke="#f5c542"
                    strokeWidth={3}
                    dot={false}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

            {/*Đây là phần thẻ bên phải*/}
          <div className="card">
            <div className="cardHeader">
              <div>
                <h2>Nhiệt độ hiện tại</h2>
                <p className="sub">Lấy record mới nhất từ /sensor_data</p>
              </div>
              <span className="badge">Live</span>
            </div>

            <div className="bigTemp">
              <div className="tempValue">
                {currentPoint ? currentPoint.temperature.toFixed(1) : "--"}
                <span className="tempUnit"> °C</span>
                <div className="tempValue">
                    {currentPoint?.hum != null ? `${currentPoint.hum.toFixed(1)}%` : "--"}
                </div>
              </div>

              <div className="tempMeta">
                {currentPoint
                  ? `Last update: ${currentPoint.timeStr ?? fmtDateTime(currentPoint.ts)}`
                  : "Chưa có dữ liệu"}
              </div>

              <div style={{ marginTop: 14, width: "100%", padding: "0 6px" }}>
                <div className="sub" style={{ marginBottom: 6 }}>Quick stats</div>
                <div className="row">
                  <span className="badge">Total points: {points.length}</span>
                  <span className="badge">History buckets: {historyBuckets.length}</span>
                  <span className="badge">Last STT: {currentPoint?.stt ?? "--"}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="historyWrap">
          <div className="card">
            <div className="cardHeader">
              <div>
                <h2>Lịch sử nhiệt độ</h2>
                <p className="sub">
                  Gom theo <b>{BUCKET_MINUTES} phút</b>, tối đa <b>{PAGE_SIZE}</b> record / trang.
                </p>
              </div>
              <span className="badge">Page {pageSafe}/{totalPages}</span>
            </div>

            <div className="cardBody">
              <div className="tableWrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Khung thời gian</th>
                      <th>Nhiệt độ</th>
                      <th>Độ ẩm</th>
                      <th>STT</th>
                      <th>Time (raw)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageRows.length === 0 ? (
                      <tr>
                        <td colSpan={5} style={{ color: "rgba(255,255,255,0.65)", padding: 14 }}>
                          Chưa có dữ liệu để tạo lịch sử (hãy chạy Node simulator hoặc bo mạch C).
                        </td>
                      </tr>
                    ) : (
                      pageRows.map((r: any) => (
                        <tr key={r.bucket}>
                          <td>{fmtDateTime(r.bucket)} → {fmtDateTime(bucketEnd(r.bucket))}</td>
                          <td style={{ fontWeight: 900, color: "#ffdf7a" }}>{r.temperature.toFixed(2)} °C</td>
                          <td>{r.hum != null ? `${Number(r.hum).toFixed(2)}%` : "--"}</td>
                          <td>{r.stt ?? "--"}</td>
                          <td>{r.timeStr ?? fmtDateTime(r.ts)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              <div className="footerBar">
                <div className="sub">
                  Total buckets: <b>{historyBuckets.length}</b>
                </div>

                {totalPages > 1 && (
                  <div className="row" style={{ gap: 8 }}>
                    <button className="btnGhost" onClick={() => setPage(1)} disabled={pageSafe === 1}>
                      First
                    </button>
                    <button className="btnGhost" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={pageSafe === 1}>
                      Prev
                    </button>
                    <button className="btnGhost" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={pageSafe === totalPages}>
                      Next
                    </button>
                    <button className="btnGhost" onClick={() => setPage(totalPages)} disabled={pageSafe === totalPages}>
                      Last
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}     
    </div>
  );
}
