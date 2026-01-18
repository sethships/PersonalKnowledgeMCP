<?php
/**
 * Simple PHP fixture for testing AST parsing
 *
 * This file contains common PHP constructs for testing:
 * - Namespace declarations
 * - Use statements (imports)
 * - Class definitions with inheritance
 * - Interface definitions
 * - Trait definitions
 * - Enum definitions
 * - Methods (static and instance)
 * - Properties
 * - Functions
 * - Require/include statements
 */

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use App\Interfaces\UserInterface;
use App\Traits\{Timestamps, SoftDeletes};

require_once 'config.php';
include './helpers.php';

/**
 * User interface for user operations
 */
interface UserInterface
{
    public function getName(): string;
    public function setName(string $name): void;
}

/**
 * Timestamps trait for created_at/updated_at
 */
trait Timestamps
{
    protected ?string $createdAt = null;
    protected ?string $updatedAt = null;

    public function getCreatedAt(): ?string
    {
        return $this->createdAt;
    }

    public function setCreatedAt(string $timestamp): void
    {
        $this->createdAt = $timestamp;
    }
}

/**
 * Status enum for user status
 */
enum UserStatus: string
{
    case Active = 'active';
    case Inactive = 'inactive';
    case Pending = 'pending';
}

/**
 * User class documentation
 * Represents a user in the system
 */
abstract class BaseUser extends Model implements UserInterface
{
    use Timestamps;

    /**
     * The user's name
     */
    protected string $name;

    /**
     * The user's email
     */
    protected ?string $email = null;

    /**
     * User status
     */
    private UserStatus $status = UserStatus::Pending;

    /**
     * Create a new user instance
     */
    public function __construct(string $name, ?string $email = null)
    {
        $this->name = $name;
        $this->email = $email;
    }

    /**
     * Get the user's name
     */
    public function getName(): string
    {
        return $this->name;
    }

    /**
     * Set the user's name
     */
    public function setName(string $name): void
    {
        $this->name = $name;
    }

    /**
     * Abstract method to be implemented by subclasses
     */
    abstract public function getDisplayName(): string;

    /**
     * Static factory method
     */
    public static function create(string $name, ?string $email = null): static
    {
        return new static($name, $email);
    }

    /**
     * Method with various parameter types
     */
    public function update(array $data, bool $validate = true, ...$options): bool
    {
        if ($validate) {
            $this->validateData($data);
        }
        foreach ($data as $key => $value) {
            $this->setAttribute($key, $value);
        }
        return $this->save();
    }
}

/**
 * Concrete User class
 */
class User extends BaseUser
{
    /**
     * Get the display name for the user
     */
    public function getDisplayName(): string
    {
        return sprintf("User: %s", $this->name);
    }

    /**
     * Send notification to user
     */
    public function notify(string $message): void
    {
        Notification::send($this, $message);
        Logger::log("Notified user: " . $this->name);
    }
}

/**
 * Simple standalone function
 */
function formatName(string $name): string
{
    return trim($name);
}

/**
 * Function with default parameters
 */
function createUser(string $name, string $email = 'default@example.com', int $age = 18): User
{
    $user = new User($name, $email);
    return $user;
}
