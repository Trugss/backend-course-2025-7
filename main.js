require('dotenv').config();
const express = require('express');
const { program } = require('commander');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const swaggerUI = require('swagger-ui-express');
const swaggerJsDoc = require('swagger-jsdoc');
const { Pool } = require('pg');

program
    .option('-h, --host <type>', 'Адреса') 
    .option('-p, --port <type>', 'Порт')
    .option('-c, --cache <type>', 'Шлях до директорії кешу')
    .parse(process.argv);

const options = program.opts();

const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,     
});

pool.connect((err, client, release) => {
    if (err) {
        return console.error('Помилка підключення до БД:', err.stack);
    }
    console.log('Успішне підключення до бази даних');
    
    client.query(`
        CREATE TABLE IF NOT EXISTS inventory (
            id SERIAL PRIMARY KEY,
            name VARCHAR(255) NOT NULL,
            description TEXT,
            photo TEXT
        )
    `, (err, res) => {
        release();
        if (err) console.error('Помилка створення таблиці:', err.stack);
    });
});

const swaggerOptions = {
    definition: {
        openapi: '3.0.0',
        info: {
            title: 'Inventory API',
            version: '1.0.0',
        },
        servers: [
            {
                url: `http://${options.host || 'localhost'}:${options.port || 3000}`
            },
        ],
    },
    apis: ['./main.js'],
};

const swaggerSpecs = swaggerJsDoc(swaggerOptions);

if (!options.cache) {
    console.error('Помилка: не задано обов\'язковий параметр --cache');
    process.exit(1);
}

const cacheDir = path.resolve(options.cache);
if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true });
    console.log(`Створено директорію кешу: ${cacheDir}`);
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, cacheDir);
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + path.extname(file.originalname));
    }
});
const upload = multer({ storage: storage });

const app = express();

app.use(express.json());
app.use(express.urlencoded({extended: true}));

app.use('/api-docs', swaggerUI.serve, swaggerUI.setup(swaggerSpecs));

app.get('/RegisterForm.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'RegisterForm.html'));
});

app.get('/SearchForm.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'SearchForm.html'));
});

/**
 * @swagger
 * /register:
 *   post:
 *     summary: Реєстрація нового предмету інвентаря
 *     tags:
 *       - Inventory
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               inventory_name:
 *                 type: string
 *               item_description:
 *                 type: string
 *               photo:
 *                 type: string
 *                 format: binary
 *     responses:
 *       201:
 *         description: Предмет успішно зареєстровано
 *       400:
 *         description: Помилка - відсутній обов'язковий параметр
 */

app.post('/register', upload.single('photo'), async (req, res) => {
    const { inventory_name, description } = req.body;

    if (!inventory_name) {
        return res.status(400).send('Помилка: inventory_name є обов\'язковим');
    }

    const photoPath = req.file ? req.file.path : null;

    try {
        const query = 'INSERT INTO inventory (name, description, photo) VALUES ($1, $2, $3) RETURNING *';
        const values = [inventory_name, description || '', photoPath];
        const result = await pool.query(query, values);
        
        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).send('Помилка сервера при збереженні');
    }
});

/**
 * @swagger
 * /inventory:
 *   get:
 *     summary: Отримати список всіх предметів інвентаря
 *     tags:
 *       - Inventory
 *     responses:
 *       200:
 *         description: Успішне отримання списку предметів
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   id:
 *                     type: integer
 *                   name:
 *                     type: string
 *                   item_description:
 *                     type: string
 *                   photo_url:
 *                     type: string
 */

app.get('/inventory', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM inventory ORDER BY id ASC');
        
        const mappedResult = result.rows.map(item => ({
            id: item.id,
            name: item.name,
            description: item.description,
            photo_url: item.photo ? `/inventory/${item.id}/photo` : null
        }));
        
        res.status(200).json(mappedResult);
    } catch (err) {
        console.error(err);
        res.status(500).send('Помилка отримання даних');
    }
});

const findItemById = (id) => inventory.find(item => item.id === parseInt(id));

/**
 * @swagger
 * /inventory/{id}:
 *   get:
 *     summary: Отримати інформацію про предмет інвентаря за ID
 *     tags:
 *       - Inventory
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Успішне отримання інформації про предмет
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id:
 *                   type: integer
 *                 name:
 *                   type: string
 *                 item_description:
 *                   type: string
 *                 photo_url:
 *                   type: string
 *       404:
 *         description: Помилка - Річ не знайдено
 */

app.get('/inventory/:id', async (req, res) => {
    try {
        const { rows } = await pool.query('SELECT * FROM inventory WHERE id = $1', [req.params.id]);
        
        if (rows.length === 0) {
            return res.status(404).send('Помилка: Річ не знайдено');
        }

        const item = rows[0];
        const result = {
            id: item.id,
            name: item.name,
            description: item.description,
            photo_url: item.photo ? `/inventory/${item.id}/photo` : null
        };
        res.status(200).json(result);
    } catch (err) {
        console.error(err);
        res.status(500).send('Помилка сервера');
    }
});

/**
 * @swagger
 * /inventory/{id}:
 *   put:
 *     summary: Оновити інформацію про предмет інвентаря за ID
 *     tags:
 *       - Inventory
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               item_description:
 *                 type: string
 *     responses:
 *       200:
 *         description: Успішне оновлення інформації про предмет
 *       404:
 *         description: Помилка - Річ не знайдено
 */

app.put('/inventory/:id', async (req, res) => {
    const { name, description } = req.body;
    try {
        const check = await pool.query('SELECT * FROM inventory WHERE id = $1', [req.params.id]);
        if (check.rows.length === 0) return res.status(404).send('Помилка: Річ не знайдено');

        const query = `
            UPDATE inventory 
            SET name = COALESCE($1, name), 
                description = COALESCE($2, description) 
            WHERE id = $3 RETURNING *
        `;
        const result = await pool.query(query, [name, description, req.params.id]);
        
        res.status(200).json(result.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).send('Помилка оновлення');
    }
});

/**
 * @swagger
 * /inventory/{id}/photo:
 *   get:
 *     summary: Отримати фото предмету інвентаря за ID
 *     tags:
 *       - Inventory
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Успішне отримання фото предмету
 *         content:
 *           image/jpeg: {}
 *       404:
 *         description: Помилка - Фото не знайдено
 */

app.get('/inventory/:id/photo', async (req, res) => {
    try {
        const { rows } = await pool.query('SELECT photo FROM inventory WHERE id = $1', [req.params.id]);
        
        if (rows.length === 0 || !rows[0].photo || !fs.existsSync(rows[0].photo)) {
            return res.status(404).send('Помилка: Фото не знайдено');
        }
        
        res.setHeader('Content-Type', 'image/jpeg');
        res.status(200).sendFile(path.resolve(rows[0].photo));
    } catch (err) {
        console.error(err);
        res.status(500).send('Помилка сервера');
    }
});

/**
 * @swagger
 * /inventory/{id}/photo:
 *   put:
 *     summary: Оновити фото предмету інвентаря за ID
 *     tags:
 *       - Inventory
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               photo:
 *                 type: string
 *                 format: binary
 *     responses:
 *       200:
 *         description: Фото оновлено
 *       400:
 *         description: Файл фото не надано
 *       404:
 *         description: Річ не знайдено
 */

app.put('/inventory/:id/photo', upload.single('photo'), async (req, res) => {
    if (!req.file) {
        return res.status(400).send('Помилка: Файл фото не надано');
    }

    try {
        const { rows } = await pool.query('SELECT photo FROM inventory WHERE id = $1', [req.params.id]);
        if (rows.length === 0) {
            fs.unlinkSync(req.file.path);
            return res.status(404).send('Помилка: Річ не знайдено');
        }

        if (rows[0].photo && fs.existsSync(rows[0].photo)) {
            fs.unlinkSync(rows[0].photo);
        }

        const updateResult = await pool.query(
            'UPDATE inventory SET photo = $1 WHERE id = $2 RETURNING photo',
            [req.file.path, req.params.id]
        );

        res.status(200).json({ message: 'Фото оновлено', path: updateResult.rows[0].photo });
    } catch (err) {
        console.error(err);
        res.status(500).send('Помилка сервера');
    }
});

/**
 * @swagger
 * /inventory/{id}:
 *   delete:
 *     summary: Видалити предмет інвентаря за ID
 *     tags:
 *       - Inventory
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Річ видалена
 *       404:
 *         description: Помилка - Річ не знайдено
 */

app.delete('/inventory/:id', async (req, res) => {
    try {
        const { rows } = await pool.query('DELETE FROM inventory WHERE id = $1 RETURNING *', [req.params.id]);
        
        if (rows.length === 0) {
            return res.status(404).send('Помилка: Річ не знайдено');
        }

        const deletedItem = rows[0];

        if (deletedItem.photo && fs.existsSync(deletedItem.photo)) {
            fs.unlinkSync(deletedItem.photo);
        }

        res.status(200).json({ message: 'Річ видалена', item: deletedItem });
    } catch (err) {
        console.error(err);
        res.status(500).send('Помилка сервера');
    }
});

/**
 * @swagger
 * /search:
 *   post:
 *     summary: Пошук предмету інвентаря за ID з опцією фото
 *     tags:
 *       - Inventory
 *     requestBody:
 *       required: true
 *       content:
 *         application/x-www-form-urlencoded:
 *           schema:
 *             type: object
 *             properties:
 *               id:
 *                 type: integer
 *               has_photo:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Успішний пошук предмету
 *       404:
 *         description: Помилка - Річ не знайдено
 */

app.post('/search', async (req, res) => {
    const { id, has_photo } = req.body;

    if (id === undefined || id === null) {
        return res.status(400).send('Помилка: не вказано ID');
    }

    try {
        const { rows } = await pool.query('SELECT * FROM inventory WHERE id = $1', [id]);
        
        if (rows.length === 0) {
            return res.status(404).send('Помилка: Річ не знайдено');
        }

        const item = rows[0];
        let description = item.description;
        const wantsPhoto = String(has_photo) === 'true' || has_photo === true || has_photo === 'on';

        if (wantsPhoto && item.photo) {
            description += ` [Фото: /inventory/${item.id}/photo]`;
        }

        const result = {
            id: item.id,
            name: item.name,
            description: description,
        };

        res.status(200).json(result);
    } catch (err) {
        console.error(err);
        res.status(500).send('Помилка сервера');
    }
});

app.all('/register', (req, res) => {
    res.status(405).send('Метод не дозволено');
});

app.use((req, res) => {
    res.status(404).send('Помилка: Ендпоінт не знайдено');
});

const serverPort = options.port || process.env.PORT || 3000;
const serverHost = options.host || '0.0.0.0';

app.listen(serverPort, serverHost, () => {
    console.log(`Сервер запущено на http://${serverHost}:${serverPort}`); 
});
