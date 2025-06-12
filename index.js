require('dotenv').config();
const express = require('express')
const cors = require('cors')
const app = express()
const port =process.env.PORT || 3000;
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');

app.use(cors());
app.use(express.json());
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.ikrarq7.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;
// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();
    const foodsCollection = client.db("food_tracker").collection("foods");
    app.get('/foods', async (req, res) => {
      const email = req.query.email;
      const query = {};
      if (email) {
       query.userEmail = email;
      }
      const result = await foodsCollection.find(query).toArray();
      res.send(result);
    });
   app.get('/foods/limit', async (req, res) => {
  try {
    const currentDate = new Date();
    const result = await foodsCollection.find({
      expiryDate: { $gt: currentDate.toISOString() } 
    })
    .sort({ expiryDate: 1 }) 
    .limit(6)
    .toArray();
    
    res.send(result);
  } catch (error) {
    console.error('Error fetching limited foods:', error);
    res.status(500).send('Internal Server Error');
  }
});

  app.get('/foods/:id', async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await foodsCollection.findOne(query);
      res.send(result);
    });
    app.post('/foods', async (req, res) => {
      const newFood = req.body;
      const result = await foodsCollection.insertOne(newFood);
      res.send(result);
    });
    app.delete('/foods/:id',async (req,res)=>{
      const id=req.params.id
      const query={_id:new ObjectId(id)}
      const result=await foodsCollection.deleteOne(query)
      res.send(result)
    })
    app.put('/foods/:id', async (req, res) => {
      const id = req.params.id;
      const updatedFood = req.body;
      const filter = { _id: new ObjectId(id) };
      const options = { upsert: true };
      const updateDoc = {
        $set: updatedFood,
      };
      const result = await foodsCollection.updateOne(filter, updateDoc, options);
      res.send(result);
    });
    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
    
  }
}
run().catch(console.dir);



app.get('/', (req, res) => {
  res.send('Server is running!')
})

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`)
})
