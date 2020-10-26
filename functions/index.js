const functions = require('firebase-functions');
const express = require('express');
const bodyParser = require('body-parser');
const uuid = require('uuid');
const path = require('path');
const moment = require('moment');
const fs = require('fs');
const cors = require('cors');
var util = require('util');
const cons = require('consolidate');
const spawn  = require('child-process-promise').spawn;
const { createWriteStream } = require('fs');
const { Storage } = require('@google-cloud/storage');
const { join } = require('path');
const { tmpdir } = require('os');
const Blob = require('blob');
const BusBoy = require('busboy');
const Stream = require('stream');
const Multer = require('multer');
var app = express();
var upload = Multer();

//admin config
const admin = require("firebase-admin");

//configurantions databaseURL
var serviceAccount = require(__dirname + "/up-transporte-firebase-admin.json");
var refreshToken;
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://up-transporte.firebaseio.com",
  storageBucket: "up-transporte.appspot.com",
  projectId: "up-transporte",
  authDomain: "up-transporte.firebaseapp.com"
});

//config to storage firebase
const gcs = new Storage({
  credential: admin.credential.cert(serviceAccount),
  projectId: 'up-transporte',
  keyFilename: __dirname + "/up-transporte-firebase-admin.json"
});

//config multer upload images
const multer = Multer({
  storage: Multer.memoryStorage()
});

//create link folder html VIEWS
app.engine('html', cons.swig);
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'html');

//initialize app e request
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cors({ origin: true }));

app.use(upload.array());
app.use(express.static('./public'));

app.post('/authentication', function(req, res) {
  let persona = req.body.persona;
  if(persona == 'driver') {
    saveDriverUser(req.body, res);
  } else if(persona == 'comum') {
    saveComumUser(req.body, res);
  }
});

app.post('/upload', function(req, res) {

  const incomingFields = {};
  const incomingFiles = {};
  const writes = [];

  let NAME_FILE_PATH = '';
  let TYPE_FILE = '';
  let PATH_FILE = '';
  let count = 0;
  let uid = uuid.v4();

  let assets = {};
  assets['asset'] = [];

  const busboy = new BusBoy({ headers: req.headers });
  let uploadData = null;

  busboy.on('field', (name, value) => {
    try {
      incomingFields[name] = JSON.parse(value);
    } catch(e) {
      incomingFields[name] = value;
    }
  })

  busboy.on('file', (field, file, filename, encoding, contentType) => {
    const filepath = join(tmpdir(), filename);
    //metadata image uploaded
    NAME_FILE_PATH = filename;
    TYPE_FILE = contentType;
    PATH_FILE = filepath;
    count++;

    let asset = createStreamFile(filename, field, file, filepath, encoding, contentType, incomingFiles, writes);
    assets['asset'].push(asset);

    let arrayParse = JSON.stringify(assets);
    let strArray = JSON.parse(arrayParse);
    let stringAsset = strArray.asset;

  })

  busboy.on('finish', async() => {
    //set files to request
    req.files = incomingFiles;
    req.body = incomingFields;

    //count done to files
    let countDone = 0;
    let objFiles = [];
    let token = uuid.v4();

    for(let i = 0; i < count; i++) {
      let done = false;
      let arrayParse = JSON.stringify(assets['asset'][i]);
      let strArray = JSON.parse(arrayParse);
      countDone++;

      let namefile = strArray.asset.name;
      let type = strArray.asset.type;
      let path = strArray.asset.path;

      objFiles[i] = namefile;

      console.log('Name file: ' + namefile);
      console.log('Type file: ' + type);
      console.log('Path file: ' + path);
      console.log('Object files name: ' + JSON.stringify(objFiles));
      console.log('Object files index: ' + objFiles[i]);
      console.log('-------------------------');
      console.log('Count done for: ' + countDone);
      console.log('Count: ' + count);

      if(countDone === count) done = true;

      fileUploadStreams(token, req.body.id, type, path, namefile, res)
      .then(() => {
        if(done) {
          responseImagesUpload(count, token, req.body.id, objFiles, res);
        }
      })
      .catch(err => {
        return res.status(500).json({
          error: err
        });
      });
    }
  });
  busboy.end(req.rawBody);
});

app.post('/token', function(req, res) {
  if(req.body.token !== null) registerNewTokenDevice(req.body.token, req.body.uid, res)
  else res.status(401).json({
    message: 'Problema ao ler token! tente novamente.', success: false
  });
});

app.post('/order', function(req, res) {
  if(req.body.id !== null) {
    sendOrderDrivers(req.body, res);
  } else {
    res.status(401).json({
     message: 'Pedido rejeitado! tente novamente.', success: false
    });
  }
});

app.put('/order-state', function(req, res) {
  if(req.body.orderId !== null && req.body.orderId !== '') {
  changeStateOrder(req.body.orderId, req.body.status, req.body.typeUser, req.body.function, res);
  } else {
   return res.status(401).json({
     message: 'Sua solicitação foi negada pelo serviço! tente novamente.', success: false
   })
 }
});

app.put('/location', function(req, res) {
  if(req.body.id !== null) {
    updateLocationUser(req.body.id, req.body.location, res);
  } else {
    res.status(401).json({
      message: 'Problema com a atualização da sua localização, reiniciei seu app.', success: false
    });
  }
});

app.get('/requests', function(req, res) {
  queryOrders(res);
});

app.post('/user', function(req, res) {
  if(req.body.id !== null) {
  retriveDataUser(req.body.id, res);
  } else {
  res.status(401).json({
    message: 'Identificação de usuario com problemas! tente novamente.', success: false
  })
}
});

app.post('/payment-method', function(req, res) {
  if(req.body.id !== null) {
    verifyPaymentUser(req.body.id, res);
  } else {
    res.status(401).json({
      message: 'Problemas ao verificar meios de pagamento. tente novamente', success: false
    });
  }
});

app.post('/create-payment', function(req, res) {
  if(req.body.id !== null) {
    saveNewPaymentMethod(req.body.id, req.body.method, res);
  } else {
    res.status(401).json({
      message: 'Problema ao salvar meio de pagamento! tente novamente.', success: false
    });
  }
});

async function saveNewPaymentMethod(id, method, response) {

  let base = admin.database();
  let reference = base.ref('usuarios' + '/' + id);

  await reference.update({
    formaPagamento: method
  })
  .then((snap) => {
    return response.status(200).json({
       message:  'Metodo de pagamento registrado com sucesso!', success: true, id: id
     });
  })
  .catch(err => {
    console.log(err);
    return response.status(500).json({
      message: err, success: false, id: id
    });
  });
}

async function verifyPaymentUser(id, response) {
  let data = {};
  data['payment'] = [];
  let counter = 0;

  var reference = admin.database().ref('usuarios' + '/' + id);
  await reference.orderByKey().on('value', function(snapshot) {
  let root = snapshot.val();
  let payment = root.formaPagamento;

  let card = {
    message: 'Metodo de pagamento encontrado.',
    success: true,
    method: payment,
    card: {
    cvv: root.payment.cvv,
    id: root.payment.id
    }
  };
  data['payment'].push(card);

  let strArray = JSON.stringify(data);
  let psrJson = JSON.parse(strArray);
  let jsonPayment = psrJson.payment;
  console.log('Root database: ' + JSON.stringify(root));

    if(payment != null) {
      if(payment == 'CREDITO') {
        response.status(200).json(jsonPayment);
      } else {
        response.status(200).json(jsonPayment);
      }
    } else {
      let bodyErr = {
        message: 'Metodo de pagamento não encontrado.',
        success: false,
        method: payment,
        card: card
      };
      response.status(401).json(bodyErr);
    }
  });
}

async function updateLocationUser(id, location, response) {
  let localizacaoAtual = location;
  let base = admin.database();
  let reference = base.ref('usuarios' + '/' + id + '/' + 'localizacaoAtual');

  await reference.update(localizacaoAtual)
  .then((snap) => {
    return response.status(200).json({
       message: 'Localização atualizada.', success: true, id: id
     });
  })
  .catch(err => {
    console.log(err);
    return response.status(500).json({
      message: err, success: false, id: id
    });
  });
}

async function retriveDataUser(id, response) {

  let data = {};
  data['user'] = [];
  let counter = 0;

  var reference = admin.database().ref('usuarios' + '/' + id);
  await reference.orderByKey().on('value', function(snapshot) {
  let root = snapshot.val();
  let location = root.localizacaoAtual;
  let user = {
    message: 'Sucesso ao encontrar perfil.',
    success: true,
    aprovado: root.aprovado,
    atualizadoEm: root.atualizadoEm,
    created: root.created,
    criadoEm: root.criadoEm,
    email: root.email,
    id: root.id,
    localizacaoAtual: location,
    multiConta: root.multiConta,
    nivelUsuario: root.nivelUsuario,
    nome: root.nome,
    nota: root.nota,
    online: root.online,
    profile: root.profile,
    saldo: root.saldo,
    satus: root.status,
    telefone: root.telefone,
    timestamp_seconds: root.timestamp_seconds,
    tipo: root.tipo,
    urls: root.urls
  };
  data['user'].push(user);

  let strArray = JSON.stringify(data);
  let psrJson = JSON.parse(strArray);
  let jsonUser = psrJson.user;

  console.log('Root database: ' + JSON.stringify(root));
    if(root != null) {
      response.status(200).json(jsonUser);
    } else {
      response.status(401).json({
        message: 'Problema ao encontrar perfil! tente novamente.', success: false
      });
    }
  });
}

async function queryOrders(response) {
  let jsson = {};
  let jssConv = {};
  let counter = 0;
  let content = {};
  content['requisicoes'] = [];

  //DATABASE REQUESTS FOR DRIVERS
  var data = admin.database();
  var reference = data.ref('requisicoes');

  await reference.once('value', function(snapshot) {
    jsson = snapshot.val();
    jssConv = JSON.stringify(jsson);

  snapshot.forEach(function(snap) {
    counter++;
    let shot = snap.val();
    let headRequests = JSON.stringify(shot);
    let head = JSON.parse(headRequests);

    var requisicoes = requestsJSON(head, snap.key);
    let state = requisicoes.status;

    if(state === 'aguardando') content['requisicoes'].push(requisicoes);

    let stringContent = JSON.stringify(content);
    let passContent = JSON.parse(stringContent);
    let responseJS = passContent.requisicoes;

    if(snapshot.numChildren() === counter)
    if(content['requisicoes'].length > 0)
     response.status(200).json({
      message: 'Novos usuarios solicitando corrida!', success: true, requests: responseJS
     })
     else return response.status(401).json({
      message: 'Nenhuma solicitacao no momento!', success: false
     })
  });
 });
}

async function changeStateOrder(id, status, typeUser, func, response) {
  let base = admin.database();
  let reference = base.ref('requisicoes' + '/' + id);

  if(func == 'query') {
   queryOrderUser(id, response);
  } else {
   if(typeUser == 'M') {
    await reference.update({
      statusMotorista: status
    })
    .then((snap) => {
      return response.status(200).json({
        message: 'Sua solicitação foi atualizada.', success: true, orderId: reference.key
       });
    })
    .catch(err => {
      console.log(err);
      return response.status(500).json({ message: err, success: false });
    });
  } else {
  await reference.update({
    status: status
  })
  .then((snap) => {
    var key = reference.key;
    return response.status(200).json({
      message: 'Sua solicitação foi atualizada.', success: true, orderId: reference.key
     });
  })
  .catch(err => {
    console.log(err);
    return response.status(500).json({ message: err, success: false });
  });
  }
 }
}

async function queryOrderUser(id, response) {
  let data = {};
  data['request'] = [];

  var reference = admin.database().ref('requisicoes' + '/' + id);
  await reference.orderByKey().on('value', function(snapshot) {
  let root = snapshot.val();

  let request = {
    message: 'Sucesso ao encontrar perfil.',
    success: true,
    status: root.status,
    statusMotorista: root.statusMotorista
  };
  data['request'].push(request);

  let strArray = JSON.stringify(data);
  let psrJson = JSON.parse(strArray);
  let jsonRequest = psrJson.request;

  console.log('Root database: ' + JSON.stringify(root));
    if(root != null) {
      response.status(200).json(jsonRequest);
    } else {
      response.status(401).json({
        message: 'Problema ao encontrar perfil! tente novamente.', success: false
      });
    }
  });
}

async function sendOrderDrivers(received, response) {
  let base = admin.database();
  let reference = base.ref('requisicoes').push();
  var key = reference.key;
  let requisicao = newRequestDriver(received, key);

  await reference.set(requisicao)
  .then((snap) => {
    return response.status(200).json({
      message: 'Sucesso ao solicitar motorista, aguarde.', success: true, orderId: key
     });
  })
  .catch(err => {
    return response.status(500).json({ message: err, success: false, orderId: '0' });
  });

}

async function saveDriverUser(received, response) {
   let driverJSON = driver(received);
   let base = admin.database();
   let reference = base.ref('usuarios' + '/' + received.id);

   //CREATE ID TO PAYMENTS METHODS ACCEPT
   let paymentDB = admin.database();
   let referencePay = paymentDB.ref('usuarios' + '/' + received.id).push();
   let keyPayments = referencePay.key;

   await reference.update(driverJSON)
   .then((snap) => {
     return response.status(200).json({
        message: 'Sucesso ao criar conta. bem vindo!', success: true, id: reference.key
      });
   })
   .catch(err => {
     console.log(err);
     return response.status(500).json({ message: err, success: false, id: reference.key });
   });
}

async function saveComumUser(received, response) {
  let comumUserJSON = comum(received);
  let base = admin.database();
  let reference = base.ref('usuarios' + '/' + received.id);

  await reference.update(comumUserJSON)
  .then((snap) => {
    return response.status(200).json({
       message:  'Autenticacao realizada com sucesso!', success: true, id: reference.key
     });
  })
  .catch(err => {
    console.log(err);
    return response.status(500).json({ message: err, success: false, id: reference.key });
  });
}

async function fileUploadStreams(token, uid, type, path, name, res) {

  var name = name;
  const metadata = {
    metadata: {
      // This line is very important. It's to create a download token.
      firebaseStorageDownloadTokens: token
    },
    contentType: type,
    cacheControl: 'public, max-age=31536000',
  };

  const destination = uid + '/' + name;
  var bucket = gcs.bucket('up-transporte.appspot.com');
  await bucket.upload(path, {
          destination: destination,
          gzip: true,
          metadata: metadata,
  });
}

async function responseImagesUpload(count, token, uid, obj, response) {
  let size = 0;
  let profileImage;
  let CNH;
  const content = {};
  content['urls'] = [];
  const bucket = gcs.bucket('up-transporte.appspot.com');

  for(let i = 0; i < count; i++) {
    size++;
    console.log('Size count for: ' + size);
    const file = bucket.file(`${uid}/${obj[i]}`);
    await file.getSignedUrl({
      action: 'read',
      expires: '03-09-2491'
    }).then(signedUrls => {
      // signedUrls[0] contains the file's public URL
      if(obj[i] === 'profile.png') profileImage = signedUrls[0];
      if(obj[i] === 'CNH.png') CNH = signedUrls[0];

      console.log('Media url: ' + signedUrls[0]);
      let urls = signedUrls[0];

      content['urls'].push(urls);
      console.log('Content media then arr: ' + JSON.stringify(content['urls']));
    });

    if(size == count) {

      let contentStr = JSON.stringify(content['urls']);
      let parseStr = JSON.parse(contentStr);

      return preSaveUrls(uid, content, response, profileImage);
    }
  }
}

async function preSaveUrls(uid, body, response, profile) {

  let usuario = PreSave(body, profile);
  let base = admin.database();
  let reference = base.ref('usuarios' + '/' + uid);
  let message = [];
  let messageBody;
  let contentMessage = '';

  await reference.set(usuario)
  .then((snap) => {
    return response.status(200).json({
      message: 'Registro de dados concluidos. bem vindo!',
      success: true, id: reference.key
    });
  })
  .catch(err => {
    console.log(err);
    return response.status(500).json(err);
  });

}

async function registerNewTokenDevice(deviceToken, uid, response) {
  let base = admin.database();
  let reference = base.ref('tokens' + '/' + uid);

  await reference.set({ token: deviceToken })
  .then((snap) => {
    return response.status(200).json({
      message: 'Sucesso ao criar token de aparelho.', success: true
    });
  })
  .catch(err => {
    console.log(err);
    return response.status(500).json({ message: err, success: false });
  });
}

function createStreamFile(filename, field, file, filepath, encoding,
  contentType, incomingFiles, writes) {
  incomingFiles[field] = incomingFiles[field] || [];
  incomingFiles[field].push({ filepath, encoding, contentType });
  const writeStream = createWriteStream(filepath);

  let asset = {
    asset: {
    path: filepath,
    name: filename,
    type: contentType
    }
  };

  writes.push(new Promise((resolve, reject) => {
    file.on('end', () => {
       writeStream.end()
    });

    writeStream.on('finish', resolve);
    writeStream.on('error', reject);
  }))

  file.pipe(writeStream);
  return asset;
}

function driver(received) {
  let nome = received.nome;
  let aprovado = true;
  let ativarCorridas = true;
  let atulizadoEm = getStamp();
  let criadoEm = getStamp();
  let email = received.email;
  let id = received.id;
  let multiConta = true;
  let nivelUsuario = 0;
  let nota = 5;
  let online = true;
  let saldo = 0;
  let status = 'DISPONIVEL';
  let telefone = received.telefone;
  let timestamp_seconds = 0;
  let tipo = 'M';

  //CARRO
  let carro = received.carro;
  //CONTA BANCARIA
  //  let conta_bancaria = received.conta_bancaria;
  //LOCALIZACAO ATUAL
  let localizacaoAtual = received.localizacaoAtual;
  //FORMAS DE PAGAMENTO
  //let formasPagamento = received.formasPagamento;

  let user = {nome, aprovado, ativarCorridas, atulizadoEm, criadoEm, email,
    id, multiConta, nivelUsuario, nota, online, saldo, status,
    telefone, timestamp_seconds, tipo, carro, localizacaoAtual};
  return user;
}

function comum(received) {
  let nome = received.nome;
  let aprovado = true;
  let formaPagamento = 'DINHEIRO';
  let atulizadoEm = getStamp();
  let criadoEm = getStamp();
  let email = received.email;
  let id = received.id;
  let multiConta = false;
  let nivelUsuario = 0;
  let nota = 5;
  let online = true;
  let saldo = 0;
  let status = 'DISPONIVEL';
  let telefone = received.telefone;
  let timestamp_seconds = 0;
  let tipo = 'P';

  //LOCALIZACAO ATUAL
  let localizacaoAtual = received.localizacaoAtual;

  let user = {nome, aprovado, atulizadoEm, criadoEm, email,
    id, multiConta, nivelUsuario, nota, online, saldo, status, telefone, timestamp_seconds,
    tipo, localizacaoAtual};
  return user;
}

function requestsJSON(body, key) {
  var name = body.name;
  var created = body.date;
  var status = body.status;

  //PARTIDA
  var partida = body.partida;
  //DESTINO
  var destino = body.destino;

  let requested = {name, created, status, partida, destino};
  return requested;
}

function PreSave(body, profileImage) {
  var profile = profileImage;
  //URLS IMAGES ASSTES
  var parseStr = body;
  var uris = [];
  uris.push(parseStr.urls);
  var dataUrl = JSON.stringify(uris);
  var parseUrl = JSON.parse(dataUrl);
  let urls = parseUrl[0];
  var created = getStamp();
  let usuario = {created, profile, urls};
  return usuario;
}

function newRequestDriver(body, key) {
  let date = getStamp();
  let formaPagamento = body.formaPagamento;
  let id = key;
  let idTransacao = body.idTransacao;
  let preco = body.preco;
  let status = body.status;
  let statusMotorista = body.statusMotorista;

  //PARTIDA
  let partidaStr = JSON.stringify(body.partida);
  let partidaPrs = JSON.parse(partidaStr);
  let partida = partidaPrs;

  //DESTINO
  let destinoStr = JSON.stringify(body.destino);
  let destinoPrs = JSON.parse(destinoStr);
  let destino = destinoPrs;

  //PASSAGEIRO
  let userStr = JSON.stringify(body.usuario);
  let userPrs = JSON.parse(userStr);
  let passageiro = userPrs;

  let requestDrive = {passageiro, partida, destino, date, formaPagamento, id, idTransacao, preco, status, statusMotorista};
  return requestDrive;
}

function getStamp() {
  var day =  moment().format("D");
  var month =  moment().format("M");
  var year =  moment().format("Y");
  var date = day + '-' + month + '-' + year;
  return date;
}

exports.app = functions.https.onRequest(app);
