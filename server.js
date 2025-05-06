const express = require("express");
const mysql = require("mysql2/promise");
const cors = require("cors");
require('dotenv').config();

const app = express();

// Configure CORS to allow requests from your Cordova app
app.use(cors({
  origin: '*', // In production, you might want to restrict this to your app's domain
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());

// Database connection pool
let pool;

async function connectToDatabase() {
  try {
    const isProduction = process.env.RAILWAY_ENVIRONMENT_NAME === 'production';

    let dbConfig;

    if (isProduction) {
      // Use Railway's database URL in production
      console.log('Using production database connection');
      dbConfig = process.env.MYSQL_URL;
    } else {
      // Use local database configuration in development
      console.log('Using local database connection');
      dbConfig = {
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0
      };
    }

    pool = mysql.createPool(dbConfig);
    console.log('Successfully connected to database');
  } catch (error) {
    console.error('Error connecting to database:', error);
  }
}
connectToDatabase();

// API endpoints
app.get('/api/scores', async (req, res) => {
  try {
    if (!pool) {
      console.error('Database pool not initialized');
      return res.status(500).json({ error: 'Database connection not established' });
    }

    console.log('Querying for all scores...');
    
    // Check if table exists
    try {
      const [tables] = await pool.query(`
        SELECT table_name FROM information_schema.tables 
        WHERE table_schema = DATABASE() AND table_name = 'topscores'
      `);

      if (tables.length === 0) {
        console.error('Table topscores does not exist');
        return res.status(500).json({ error: 'Table does not exist' });
      }
    } catch (tableError) {
      console.error('Error checking table:', tableError);
      return res.status(500).json({ error: 'Failed to check table existence', details: tableError.message });
    }

    const [rows] = await pool.query('SELECT * FROM topscores ORDER BY score DESC');

    const oScores = {
      aScoresEurope: [],
      aScoresAsia: [],
      aScoresAfrica: []
    };

    rows.forEach(oRecord => {
      if (oRecord.regionId === 1) {
        oScores.aScoresEurope.push(oRecord);
      } else if (oRecord.regionId === 2) {
        oScores.aScoresAsia.push(oRecord);
      } else if (oRecord.regionId === 3) {
        oScores.aScoresAfrica.push(oRecord);
      }
    });

    res.json(oScores);
  } catch (error) {
    console.error('Database query error:', error);
    res.status(500).json({ error: 'Database error', message: error.message });
  }
});

app.post('/api/scores', async (req, res) => {
  try {
    const { playerName, score, regionId } = req.body;

    // Validate the data
    if (!playerName || score === undefined || regionId === undefined) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Insert into database
    const [result] = await pool.query(
      'INSERT INTO topscores (playerName, score, regionId) VALUES (?, ?, ?)',
      [playerName, score, regionId]
    );

    res.status(201).json({
      success: true,
      id: result.insertId,
      message: 'Score saved successfully'
    });

  } catch (error) {
    console.error('Error saving score:', error);
    res.status(500).json({ error: 'Failed to save score', message: error.message });
  }
});

// API health check endpoint
app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'OK', message: 'API is running' });
});

// Root route that provides API info
app.get('/', (req, res) => {
  res.status(200).json({
    name: 'UI5 Game Score API',
    version: '1.0.0',
    endpoints: [
      { method: 'GET', path: '/api/scores', description: 'Get all scores' },
      { method: 'POST', path: '/api/scores', description: 'Save a new score' },
      { method: 'GET', path: '/api/health', description: 'API health check' }
    ]
  });
});

const PORT = process.env.PORT || 3300;
app.listen(PORT, () => {
  console.log('Score API server running on port ' + PORT);
});