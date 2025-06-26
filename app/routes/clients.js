const express = require("express");
const router = express.Router();
const clientController = require("../controllers/clientController");
const auth = require("../middlewares/auth");




router.post("/", auth, clientController.addClient);
router.get("/", auth, clientController.getAllClients);
router.put("/:id", auth, clientController.updateClient);
router.delete("/:id", auth, clientController.deleteClient);

module.exports = router;
