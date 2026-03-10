FROM node:18-alpine

# Создаем директорию приложения
WORKDIR /app

# Копируем package.json и устанавливаем зависимости
COPY package*.json ./
RUN npm install --production

# Копируем весь остальной код
COPY . .

# Открываем порт 3000
EXPOSE 3000

# Запускаем сервер
CMD ["npm", "start"]