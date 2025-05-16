const express = require("express");
const mysql = require("mysql2/promise");
const cors = require("cors");
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const crypto = require('crypto');

require('dotenv').config();

const app = express();

const JWT_SECRET = process.env.JWT_SECRET || '2fbcefab3a25e6c28651e96b681a35afdc14247940f7b9d3d4dfe820d63e091d'; // Use environment variable in production!

const transporter = nodemailer.createTransport({
    service: process.env.EMAIL_SERVICE || 'gmail',
    auth: {
        user: process.env.EMAIL_USER || 'countries.quiz.mpp@gmail.com',
        pass: process.env.EMAIL_PASSWORD || 'dwqc cerw yuao ardk'
    }
});

function generateVerificationToken() {
    return crypto.randomBytes(32).toString('hex');
};

// Helper function to send verification email
async function sendVerificationEmail(email, token, username) {
    // Determine the application URL (for email verification links)
    const baseUrl = process.env.APP_URL || 'http://localhost:3300';
    const verificationUrl = `${baseUrl}/api/auth/verify-email?token=${token}`;

    const mailOptions = {
        from: process.env.EMAIL_USER,
        to: email,
        subject: 'Please verify your email address for CountriesQuiz',
        html: `
        <h1>Email Verification</h1>
        <p>Hello ${username},</p>
        <p>Thank you for registering with CountriesQuiz. Please verify your email address by clicking the link below:</p>
        <a href="${verificationUrl}">Verify Email Address</a>
        <p>This link will expire in 24 hours.</p>
        <p>If you did not create an account, you can safely ignore this email.</p>
      `
    };

    try {
        await transporter.sendMail(mailOptions);
        return true;
    } catch (error) {
        console.error('Error sending email:', error);
        return false;
    }
}



// Configure CORS to allow requests from Cordova app
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

// Register endpoint
app.post('/api/auth/register', async (req, res) => {
    try {
        const { username, email, password } = req.body;

        // Validate input
        if (!username || !email || !password) {
            return res.status(400).json({ error: 'All fields are required' });
        }

        // Check if user already exists
        const [existingUsers] = await pool.query(
            'SELECT * FROM users WHERE email = ? OR username = ?',
            [email, username]
        );

        if (existingUsers.length > 0) {
            return res.status(409).json({ error: 'User already exists' });
        }

        // Hash password
        const saltRounds = 10;
        const passwordHash = await bcrypt.hash(password, saltRounds);

        // Generate verification token
        const verificationToken = generateVerificationToken();
        const tokenExpiry = new Date();
        tokenExpiry.setHours(tokenExpiry.getHours() + 24); // Token expires in 24 hours

        // Store user in database
        const [result] = await pool.query(
            'INSERT INTO users (username, email, password_hash, verification_token, token_expiry, is_verified) VALUES (?, ?, ?, ?, ?, ?)',
            [username, email, passwordHash, verificationToken, tokenExpiry, false]
        );

        // Send verification email
        const emailSent = await sendVerificationEmail(email, verificationToken, username);

        res.status(201).json({
            success: true,
            message: 'User registered successfully. Please check your email to verify your account.',
            userId: result.insertId,
            emailSent
        });

    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ error: 'Server error during registration' });
    }
});

// Email verification endpoint
app.get('/api/auth/verify-email', async (req, res) => {
    try {
        const { token } = req.query;

        if (!token) {
            return res.status(400).send(createHtmlResponse(
                'Verification Failed',
                'Verification token is missing',
                'error'
            ));
        }

        // Find user with this token
        const [users] = await pool.query(
            'SELECT * FROM users WHERE verification_token = ?',
            [token]
        );

        if (users.length === 0) {
            return res.status(404).send(createHtmlResponse(
                'Verification Failed',
                'Invalid verification token. Please check your email and try again.',
                'error'
            ));
        }

        const user = users[0];

        // Check if token has expired
        const tokenExpiry = new Date(user.token_expiry);
        if (tokenExpiry < new Date()) {
            return res.status(400).send(createHtmlResponse(
                'Verification Failed',
                'Verification token has expired. Please request a new one.',
                'error'
            ));
        }

        // Mark user as verified
        await pool.query(
            'UPDATE users SET is_verified = true, verification_token = NULL WHERE id = ?',
            [user.id]
        );

        // Return HTML response instead of JSON
        return res.send(createHtmlResponse(
            'Email Verified Successfully',
            `Thank you ${user.username}! Your email has been verified successfully. You can now log in to your CountriesQuiz account.`,
            'success'
        ));

    } catch (error) {
        console.error('Email verification error:', error);
        return res.status(500).send(createHtmlResponse(
            'Verification Error',
            'An error occurred during verification. Please try again later.',
            'error'
        ));
    }
});

// Resend verification email endpoint with rate limiting
app.post('/api/auth/resend-verification', async (req, res) => {
    try {
        const { email } = req.body;

        if (!email) {
            return res.status(400).json({ error: 'Email is required' });
        }

        // Find user with this email
        const [users] = await pool.query(
            'SELECT * FROM users WHERE email = ?',
            [email]
        );

        if (users.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        const user = users[0];

        // Check if already verified
        if (user.is_verified) {
            return res.status(400).json({ error: 'Email is already verified' });
        }

        // Check for cooldown period (e.g., 5 minutes between resend attempts)
        const cooldownMinutes = 10; // Adjust this value as needed
        
        // Add a last_email_sent field to your users table if it doesn't exist
        // ALTER TABLE users ADD COLUMN last_email_sent DATETIME NULL;
        
        if (user.last_email_sent) {
            const lastSent = new Date(user.last_email_sent);
            const cooldownExpiry = new Date(lastSent.getTime() + (cooldownMinutes * 60000));
            const now = new Date();
            
            if (now < cooldownExpiry) {
                const remainingSeconds = Math.ceil((cooldownExpiry - now) / 1000);
                const remainingMinutes = Math.ceil(remainingSeconds / 60);
                
                return res.status(429).json({ 
                    status: 429,
                    retryAfter: remainingSeconds
                });
            }
        }

        // Generate new verification token
        const verificationToken = generateVerificationToken();
        const tokenExpiry = new Date();
        tokenExpiry.setHours(tokenExpiry.getHours() + 24); // Token expires in 24 hours

        // Update user with new token and record when email was sent
        await pool.query(
            'UPDATE users SET verification_token = ?, token_expiry = ?, last_email_sent = NOW() WHERE id = ?',
            [verificationToken, tokenExpiry, user.id]
        );

        // Send verification email
        const emailSent = await sendVerificationEmail(email, verificationToken, user.username);

        if (emailSent) {
            res.json({ 
                success: true, 
                message: 'Verification email sent successfully',
                cooldownMinutes: cooldownMinutes // Inform frontend of the cooldown period
            });
        } else {
            res.status(500).json({ error: 'Failed to send verification email' });
        }

    } catch (error) {
        console.error('Resend verification error:', error);
        res.status(500).json({ error: 'Server error during email verification' });
    }
});

// Login endpoint
app.post('/api/auth/login', async (req, res) => {
    try {
        const { username, password } = req.body;

        // Find user
        const [users] = await pool.query(
            'SELECT * FROM users WHERE username = ? OR email = ?',
            [username, username]
        );

        if (users.length === 0) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const user = users[0];

        // Compare password
        const passwordMatch = await bcrypt.compare(password, user.password_hash);

        if (!passwordMatch) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        // Check if email is verified
        if (!user.is_verified) {
            return res.status(403).json({
                error: 'Email not verified',
                emailVerification: true,
                email: user.email
            });
        }

        // Update last login
        await pool.query('UPDATE users SET last_login = NOW() WHERE id = ?', [user.id]);

        // Generate JWT token
        const token = jwt.sign(
            {
                userId: user.id,
                username: user.username
            },
            JWT_SECRET,
            { expiresIn: '7d' }
        );

        res.json({
            success: true,
            token,
            user: {
                id: user.id,
                username: user.username,
                email: user.email,
                isVerified: user.is_verified
            }
        });

    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Server error during login' });
    }
});

// Middleware to verify token
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'Authentication required' });
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ error: 'Invalid or expired token' });
        }

        req.user = user;
        next();
    });
};

// Protected endpoint example
app.get('/api/user/profile', authenticateToken, async (req, res) => {
    try {
        const [users] = await pool.query('SELECT id, username, email, created_at FROM users WHERE id = ?', [req.user.userId]);

        if (users.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        res.json(users[0]);
    } catch (error) {
        console.error('Error fetching profile:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// API health check endpoint
app.get('/api/health', (req, res) => {
    res.status(200).json({ status: 'OK', message: 'API is running' });
});

// Root route that provides API info
app.get('/', (req, res) => {
    res.status(200).json({
        name: 'CountriesQuiz API info',
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

// Helper function to create HTML response
function createHtmlResponse(title, message, status) {
    const baseUrl = process.env.APP_URL || 'http://localhost:8080/index.html';
    const color = status === 'success' ? '#4CAF50' : '#f44336';
    const icon = status === 'success' ? '✓' : '✗';
    
    return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>CountriesQuiz - ${title}</title>
        <style>
            body {
                font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                background-color: #f5f5f5;
                margin: 0;
                padding: 0;
                display: flex;
                justify-content: center;
                align-items: center;
                min-height: 100vh;
            }
            .container {
                background-color: white;
                border-radius: 8px;
                box-shadow: 0 4px 10px rgba(0, 0, 0, 0.1);
                padding: 40px;
                max-width: 500px;
                text-align: center;
            }
            .icon {
                font-size: 64px;
                color: ${color};
                margin-bottom: 20px;
            }
            h1 {
                color: #333;
                margin-bottom: 20px;
            }
            p {
                color: #666;
                line-height: 1.6;
                margin-bottom: 30px;
            }
            .button {
                background-color: #007BFF;
                color: white;
                padding: 12px 24px;
                border: none;
                border-radius: 4px;
                text-decoration: none;
                font-size: 16px;
                transition: background-color 0.3s;
                cursor: pointer;
            }
            .button:hover {
                background-color: #0069d9;
            }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="icon">${icon}</div>
            <h1>${title}</h1>
            <p>${message}</p>
            <a href="${baseUrl}" class="button">Go to CountriesQuiz</a>
        </div>
    </body>
    </html>
    `;
}