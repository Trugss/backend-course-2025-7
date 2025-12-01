const express = require('express');
const { program } = require('commander');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const swaggerUI = require('swagger-ui-express');
const swaggerJsDoc = require('swagger-jsdoc');

program
    .option('-h, --host <type>', 'Адреса') 
    .option('-p, --port <type>', 'Порт')
    .option('-c, --cache <type>', 'Шлях до директорії кешу')
    .parse(process.argv);

const options = program.opts();

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

const dbPath = path.join(cacheDir, 'inventory.json');

let inventory = [];
let currentId = 0;

const saveData = () => {
    const dataToSave = {
        inventory: inventory,
        currentId: currentId 
    };
    fs.writeFileSync(dbPath, JSON.stringify(dataToSave, null, 2));
};

if (fs.existsSync(dbPath)) {
    try {
        const rawData = fs.readFileSync(dbPath);
        const data = JSON.parse(rawData);
 
        if (Array.isArray(data)) {
             inventory = data;
             currentId = inventory.length > 0 ? Math.max(...inventory.map(i => i.id)) + 1 : 0;
        } else {
             inventory = data.inventory || [];
             currentId = data.currentId || 0;
        }
        console.log(`Завантажено ${inventory.length} елементів. Наступний ID: ${currentId}`);
    } catch (err) {
        console.error("Помилка читання бази даних:", err);
        inventory = [];
        currentId = 0;
    }
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

app.post('/register', upload.single('photo'), (req, res) => {
    const { inventory_name, description } = req.body;

    if (!inventory_name) {
        return res.status(400).send('Помилка: inventory_name є обов\'язковим');
    }

    const newItem = {
        id: currentId++, 
        name: inventory_name,
        description: description || '',
        photo: req.file ? req.file.path : null
    };

    inventory.push(newItem);
    saveData();
    res.status(201).json(newItem);
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

app.get('/inventory', (req, res) => {
    const result = inventory.map(item => ({
        id: item.id,
        name: item.name,
        description: item.description,
        photo_url: item.photo ? `/inventory/${item.id}/photo` : null
    }));
    res.status(200).json(result);
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

app.get('/inventory/:id', (req, res) => {
    const item = findItemById(req.params.id);
    if (!item) {
        return res.status(404).send('Помилка: Річ не знайдено');
    }

    const result = {
        id: item.id,
        name: item.name,
        description: item.description,
        photo_url: item.photo ? `/inventory/${item.id}/photo` : null
    };
    res.status(200).json(result);
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

app.put('/inventory/:id', (req, res) => {
    const item = findItemById(req.params.id);
    if (!item) {
        return res.status(404).send('Помилка: Річ не знайдено');
    }

    if (req.body.name) item.name = req.body.name;
    if (req.body.description) item.description = req.body.description;

    saveData();
    res.status(200).json(item);
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

app.get('/inventory/:id/photo', (req, res) => {
    const item = findItemById(req.params.id);

    if (!item || !item.photo || !fs.existsSync(item.photo)) {
        return res.status(404).send('Помилка: Фото не знайдено');

    }
    res.setHeader('Content-Type', 'image/jpeg');
    res.status(200).sendFile(item.photo);
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

app.put('/inventory/:id/photo', upload.single('photo'), (req, res) => {
    const item = findItemById(req.params.id);

    if (!item) {
        return res.status(404).send('Помилка: Річ не знайдено');
    }

    if (!req.file) {
        return res.status(400).send('Помилка: Файл фото не надано');
    }

    if (item.photo && fs.existsSync(item.photo)) fs.unlinkSync(item.photo);

    item.photo = req.file.path;
    saveData();
    res.status(200).json({  message: 'Фото оновлено', path: item.photo });
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

app.delete('/inventory/:id', (req, res) => {
    const index = inventory.findIndex(item => item.id === parseInt(req.params.id));
    if (index === -1) {
        return res.status(404).send('Помилка: Річ не знайдено');
    }

    const deletedItem = inventory.splice(index, 1);

    if (deletedItem[0].photo && fs.existsSync(deletedItem[0].photo)) {
        fs.unlinkSync(deletedItem[0].photo);
    }

    saveData();
    res.status(200).json({ message: 'Річ видалена', item: deletedItem[0] });
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

app.post('/search', (req, res) => {
    const { id, has_photo } = req.body;

    if (id === undefined || id === null) {
        return res.status(400).send('Помилка: не вказано ID');
    }

    const item = findItemById(id);
    if (!item) {
        return res.status(404).send('Помилка: Річ не знайдено');
    }

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
});

app.all('/register', (req, res) => {
    res.status(405).send('Метод не дозволено');
});

app.use((req, res) => {
    res.status(404).send('Помилка: Ендпоінт не знайдено');
});

app.listen(options.port, options.host, () => {
    console.log(`Сервер запущено на http://${options.host}:${options.port}`); 
});
