const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const { RtcTokenBuilder, RtcRole } = require('agora-token');

const app = express();
const server = http.createServer(app);

// CORS - allow Vercel domain
const io = new Server(server, {
  cors: {
    origin: ['https://roverbet-app.vercel.app', 'http://localhost:3000'],
    methods: ['GET', 'POST']
  }
});

app.use(cors({
  origin: ['https://roverbet-app.vercel.app', 'http://localhost:3000']
}));
app.use(express.json());

// Agora credentials
const AGORA_APP_ID = '431182120b824bf280c1e662da3dc4f3';
const AGORA_APP_CERT = '09402aac5e16493095b3b421f8ecfc7f';

// Roast word pairs
const WORD_PAIRS = [
  ['Pizza','Biryani'],['Car','Bike'],['WhatsApp','Instagram'],
  ['Cricket','Football'],['Tea','Coffee'],['Night','Morning'],
  ['Mumbai','Delhi'],['Cat','Dog'],['Movies','WebSeries'],
  ['Gym','Sleep'],['Books','YouTube'],['AC','Fan'],
  ['Train','Flight'],['Android','iPhone'],['Rich','Famous'],
  ['City','Village'],['Fast Food','Home Food'],['TikTok','YouTube'],
  ['Morning Person','Night Owl'],['Introvert','Extrovert']
];

// Matchmaking queue
let waitingQueue = [];
// Active rooms
let activeRooms = {};

// ── Health check ──
app.get('/', (req, res) => {
  res.json({ 
    status: 'ROVERBET Backend Running 🔥',
    rooms: Object.keys(activeRooms).length,
    waiting: waitingQueue.length
  });
});

// ── Generate Agora Token ──
app.post('/agora-token', (req, res) => {
  try {
    const { channelName, uid } = req.body;
    if (!channelName) return res.status(400).json({ error: 'channelName required' });
    
    const expirationTimeInSeconds = 3600;
    const currentTimestamp = Math.floor(Date.now() / 1000);
    const privilegeExpiredTs = currentTimestamp + expirationTimeInSeconds;
    const uidNum = uid || Math.floor(Math.random() * 100000);

    const token = RtcTokenBuilder.buildTokenWithUid(
      AGORA_APP_ID,
      AGORA_APP_CERT,
      channelName,
      uidNum,
      RtcRole.PUBLISHER,
      privilegeExpiredTs,
      privilegeExpiredTs
    );

    res.json({ token, uid: uidNum, appId: AGORA_APP_ID });
  } catch(e) {
    console.error('Token error:', e);
    res.status(500).json({ error: 'Token generation failed' });
  }
});

// ── Socket.io for real-time matchmaking ──
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // Join matchmaking queue
  socket.on('find-opponent', (userData) => {
    console.log('Finding opponent for:', userData.name);
    
    // Remove any existing entry for this user
    waitingQueue = waitingQueue.filter(u => u.uid !== userData.uid);

    // Check if someone is waiting
    const opponent = waitingQueue.find(u => u.uid !== userData.uid);

    if (opponent) {
      // Match found!
      waitingQueue = waitingQueue.filter(u => u.uid !== opponent.uid);
      
      const pair = WORD_PAIRS[Math.floor(Math.random() * WORD_PAIRS.length)];
      const channelId = 'debate_' + Date.now();
      
      const roomData = {
        channelId,
        p1: { socketId: opponent.socketId, uid: opponent.uid, name: opponent.name, word: pair[0] },
        p2: { socketId: socket.id, uid: userData.uid, name: userData.name, word: pair[1] },
        createdAt: Date.now()
      };
      
      activeRooms[channelId] = roomData;

      // Notify both players
      io.to(opponent.socketId).emit('match-found', {
        channelId,
        opponentName: userData.name,
        myWord: pair[0],
        opponentWord: pair[1]
      });

      socket.emit('match-found', {
        channelId,
        opponentName: opponent.name,
        myWord: pair[1],
        opponentWord: pair[0]
      });

      console.log('Match found:', opponent.name, 'vs', userData.name, 'Word:', pair[0], 'vs', pair[1]);

    } else {
      // Add to waiting queue
      waitingQueue.push({
        socketId: socket.id,
        uid: userData.uid,
        name: userData.name,
        joinedAt: Date.now()
      });
      
      socket.emit('waiting', { position: waitingQueue.length });
      console.log('Waiting queue:', waitingQueue.length);

      // Auto-remove from queue after 25 seconds
      setTimeout(() => {
        waitingQueue = waitingQueue.filter(u => u.socketId !== socket.id);
        socket.emit('no-opponent');
      }, 25000);
    }
  });

  // Cancel search
  socket.on('cancel-search', () => {
    waitingQueue = waitingQueue.filter(u => u.socketId !== socket.id);
    console.log('Search cancelled by:', socket.id);
  });

  // Live chat in debate room
  socket.on('debate-chat', (data) => {
    socket.to(data.channelId).emit('debate-chat', data);
  });

  // Vote submitted
  socket.on('vote', (data) => {
    const room = activeRooms[data.channelId];
    if (room) {
      if (!room.votes) room.votes = {};
      room.votes[data.voterId] = data.votedFor;
      io.to(data.channelId).emit('vote-update', { votes: room.votes });
    }
  });

  // Join room as audience
  socket.on('join-room', (channelId) => {
    socket.join(channelId);
    const room = activeRooms[channelId];
    if (room) {
      if (!room.audienceCount) room.audienceCount = 0;
      room.audienceCount++;
      io.to(channelId).emit('viewer-count', room.audienceCount);
    }
  });

  // Comedy room reactions
  socket.on('react', (data) => {
    socket.to(data.channelId).emit('react', data);
  });

  // Disconnect
  socket.on('disconnect', () => {
    waitingQueue = waitingQueue.filter(u => u.socketId !== socket.id);
    console.log('User disconnected:', socket.id);
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`ROVERBET Backend running on port ${PORT} 🔥`);
});
