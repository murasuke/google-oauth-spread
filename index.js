// index.js
/* *******************************************************************
 * Express設定
 * ・passport.jsでuserを保持するためsessionを利用
 * ******************************************************************/
require('dotenv').config();
const express = require('express');
const app = express();
const session = require('express-session');

app.set('view engine', 'ejs');
// formからのデータ受け取り
app.use(express.urlencoded({ extended: true }));

app.use(
  session({
    resave: false,
    saveUninitialized: true,
    secret: 'SECRET',
  })
);

const port = process.env.APP_PORT || 3000;
app.listen(port, () => console.log('App listening on port ' + port));

/* *******************************************************************
 * Passport設定
 * ・Strategyはpassport-google-oauthを利用
 * ******************************************************************/
const passport = require('passport');

app.use(passport.initialize());
app.use(passport.session());

// ログアウト
app.get('/logout', (req, res, next) => {
  req.logout((err) => {
    if (err) {
      return next(err);
    }
    res.redirect('/');
  });
});

app.get('/error', (req, res) => res.send('error logging in'));

// ユーザー情報をsessionに保存
passport.serializeUser((user, done) => {
  console.log(user);
  done(null, user);
});

// セッションからユーザー情報の復元(req.user)
passport.deserializeUser((obj, done) => {
  done(null, obj);
});

/* *******************************************************************
 * Google OAuth2 認証設定
 * ・Google Developer Consoleで認証情報を作成しておく
 *   参考URL https://qiita.com/7032/items/50fc96b6e8c9ac90c32f
 * ・作成した認証情報のclientIdと、clientSecretを環境変数にセットしておくこと
 * ******************************************************************/
const GoogleStrategy = require('passport-google-oauth').OAuth2Strategy;
const fs = require('fs');
const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } = process.env;
passport.use(
  new GoogleStrategy(
    {
      clientID: GOOGLE_CLIENT_ID,
      clientSecret: GOOGLE_CLIENT_SECRET,
      callbackURL: `http://localhost:${port}/auth/google/callback`,
    },
    (accessToken, refreshToken, profile, done) => {
      // Verify Function (ユーザー存在チェック等を行う)
      //  問題がなければユーザー情報callbackに渡すことでreq.userに格納される
      // ユーザー情報とtokenをファイルに保存
      let data = { ...profile, accessToken, refreshToken };
      fs.writeFileSync('token.txt', JSON.stringify(data));
      return done(null, data);
    }
  )
);

// 認証
// ・スプレッドシートを読み書きするためのscopeを指定
app.get(
  '/auth/google',
  passport.authenticate('google', {
    scope: ['profile', 'email', 'https://www.googleapis.com/auth/spreadsheets'],
    accessType: 'offline',
    prompt: 'consent',
  })
);

// 認証後のcallback
app.get(
  '/auth/google/callback',
  passport.authenticate('google', { failureRedirect: '/error' }),
  (req, res) => {
    // 認証成功時
    res.redirect('/');
  }
);

/* *******************************************************************
 * Google API (Sheets) 利用サンプル
 * ・書き込み先スプレッドシート(URL)を入力する画面を表示する
 * ・OAuth2認証で取得したaccessToken, refreshTokenを使いSheetに書き込みを行う
 * ******************************************************************/
// メインページ(スプレッドシートURL、書き込みデータ入力画面)を表示(GET)
app.get('/', (req, res) => {
  const token = fs.existsSync('token.txt')
    ? JSON.parse(fs.readFileSync('token.txt'))
    : null;
  res.render('pages/sheet', {
    error_message: '',
    sheetURL: '',
    insertValue: '',
    user: token,
  });
});

const { google } = require('googleapis');

// OAuth2Clientを初期化
const oAuth2Client = new google.auth.OAuth2({
  clientId: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
});

// 指定されたスプレッドシートにデータを追記する(POST)
app.post('/', async (req, res) => {
  // フォーム入力値
  const { sheetURL, insertValue, redirectToSheet, deleteToken } = req.body;
  // token削除ボタン押下時、ファイルを削除
  if (deleteToken) {
    fs.unlinkSync('token.txt');
    res.redirect('/');
    return;
  }

  // スプレッドシートIDを抜き出す
  const match = sheetURL.match(/spreadsheets\/d\/([0-9a-zA-Z\-_]+)/);
  if (!match) {
    res.render('pages/sheet', {
      ...req.body,
      user: req.user,
      error_message: 'URLが無効です',
    });
    return;
  }
  const spreadsheetId = match[1];

  // ログイン時に取得したトークンをセット
  const token = JSON.parse(fs.readFileSync('token.txt'));
  oAuth2Client.setCredentials({
    refresh_token: token.refreshToken,
    access_token: token.accessToken,
  });

  // API経由でスプレッドシートへ書き込み
  const sheets = google.sheets({ version: 'v4', auth: oAuth2Client });
  const param = {
    spreadsheetId: spreadsheetId,
    range: 'シート1!A1',
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS', // 最後に追加
    resource: {
      values: [insertValue.split(',')],
    },
  };
  // スプレッドシートにデータを追加
  await sheets.spreadsheets.values.append(param);

  if (redirectToSheet == 'checked') {
    // リダイレクトを指定した場合、スプレッドシートを表示
    res.redirect(
      `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit#gid=0`
    );
  } else {
    res.render('pages/sheet', {
      ...req.body,
      user: req.user,
      error_message: '',
    });
  }
});
