import torch
import torch.nn as nn
import logging

logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')
logger = logging.getLogger("Echo-LGNN-Tensor")

class EchoProphitNet(nn.Module):
    """
    Project Echo: LGNN Swarm Node
    Calculates Topological Prediction Error for Artifact Restitution using Vector Embeddings.
    """
    def __init__(self, embedding_dim=768, hidden_dim=256):
        super(EchoProphitNet, self).__init__()
        self.fc1 = nn.Linear(embedding_dim, hidden_dim)
        self.relu = nn.ReLU()
        # Output: [Confidence Score, Colonial Violence Vector, Restitution Probability Vector]
        self.fc2 = nn.Linear(hidden_dim, 3)
        self.sigmoid = nn.Sigmoid()

    def forward(self, metadata_embedding):
        x = self.fc1(metadata_embedding)
        x = self.relu(x)
        x = self.fc2(x)
        # Apply sigmoid to normalize outputs to 0.0 - 1.0 (probabilities)
        return self.sigmoid(x)

def binary_shannon_entropy(prediction: torch.Tensor, eps: float = 1e-7) -> torch.Tensor:
    """
    Computes binary Shannon entropy H(p) = -p log(p) - (1-p) log(1-p) >= 0 for probabilities p in [0, 1].
    """
    p = torch.clamp(prediction, eps, 1.0 - eps)
    return -(p * torch.log(p) + (1.0 - p) * torch.log(1.0 - p))


def liquid_entropy_loss(prediction: torch.Tensor, ground_truth_labels: torch.Tensor, alpha: float = 0.1) -> torch.Tensor:
    """
    Calculates MSE prediction error regularized by negative binary Shannon entropy
    (overconfidence penalty: log(2) - H(p) >= 0, which is 0 at p=0.5 and maximal at p in {0, 1}).
    """
    mse_loss = nn.MSELoss()
    base_loss = mse_loss(prediction, ground_truth_labels)

    import math
    entropy = binary_shannon_entropy(prediction)
    overconfidence_penalty = torch.mean(math.log(2.0) - entropy)

    total_loss = base_loss + (alpha * overconfidence_penalty)
    return total_loss

if __name__ == "__main__":
    logger.info("🕸️ Initializing Project Echo LGNN Tensor Engine...")
    
    # Simulate a CLIP/HuggingFace Vector Embedding (e.g. from an artifact's text + image)
    # Batch size 1, Embedding Dim 768
    simulated_metadata_vector = torch.randn(1, 768)
    logger.info(f"Generated Simulated Input Vector (Shape: {simulated_metadata_vector.shape})")
    
    # Initialize the Neural Network
    model = EchoProphitNet()
    
    # Forward Pass
    prediction = model(simulated_metadata_vector)
    
    confidence = prediction[0][0].item() * 100
    violence_marker = prediction[0][1].item() * 100
    restitution_prob = prediction[0][2].item() * 100
    
    logger.info("--- TENSOR DISPATCH RESULT ---")
    logger.info(f"Overall Confidence:    {confidence:.2f}%")
    logger.info(f"Violence Marker:       {violence_marker:.2f}%")
    logger.info(f"Restitution Prob:      {restitution_prob:.2f}%")
    logger.info("------------------------------")
    
    # Ground Truth Simulation (e.g. from a known looted artifact like Ngonnso)
    ground_truth = torch.tensor([[1.0, 1.0, 1.0]])
    
    # Calculate Prediction Error
    loss = liquid_entropy_loss(prediction, ground_truth)
    logger.info(f"Liquid Entropy Loss (Prediction Error): {loss.item():.4f}")
    
    # Backward Pass (Federated Gradient computation)
    loss.backward()
    logger.info("Backpropagation Complete. Gradients ready for P2P Gossip.")
