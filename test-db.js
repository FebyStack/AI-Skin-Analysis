import { Pool } from "pg";

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});

async function testConnection() {
    try {
        const result = await pool.query("SELECT NOW()");
        console.log("✅ Database connected!");
        console.log(result.rows[0]);
    } catch (err) {
        console.error("❌ Connection failed:", err);
    } finally {
        await pool.end();
    }
}

testConnection();