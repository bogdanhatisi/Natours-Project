// eslint-disable-next-line import/no-unresolved, node/no-missing-require

const mongoose = require('mongoose');
const dotenv = require('dotenv');

process.on('uncaughtException', (err) => {
  console.log('UNCAUGHT EXCEPTION! Shutting down the app...');
  console.log(err.name, err.message);

  process.exit(1);
});

dotenv.config({ path: './config.env' });

const app = require('./app');

const DB = process.env.DATABASE.replace(
  '<PASSWORD>',
  process.env.DATABASE_PASSWORD
);

//connecting our app to the database
mongoose
  .connect(DB, {
    useNewUrlParser: true,
    useCreateIndex: true,
    useFindAndModify: false,
  })
  .then(() => console.log('DB connection successful'));

// console.log(app.get('env'));
// console.log(process.env);

// START SERVER
const port = process.env.PORT || 3000;
const server = app.listen(port, () => {
  //   console.log(`App running on port  ${port}`);
}); // starting the server

process.on('unhandledRejection', (err) => {
  console.log('UNHANDLED REJECTION! Shutting down the app...');
  console.log(err);

  server.close(() => {
    process.exit(1);
  });
});
