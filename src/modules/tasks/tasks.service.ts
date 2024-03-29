import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Task } from './schemas/task.schema';
import { TaskI } from 'src/shared/interfaces/task.interface';
import { CreateTaskDto } from './dto/create-task.dto';
import { IUser } from '../../shared/interfaces/user.interface';
import { Role } from 'src/shared/enums/role.enum';
import { AwsService } from '../aws/aws.service';
import { UpdateTaskDto } from './dto/update-task.dto';
import { UpdateAuditTaskDto } from './dto/update-audit-task.dto';
import { CreateCommentDto } from './dto/create-comment.dto';
import { UpdateCommentDto } from './dto/update-comment.dto';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class TasksService {
  constructor(
    @InjectModel(Task.name) private readonly taskModel: Model<TaskI>,
    private awsService: AwsService,
  ) {}

  async createTask(createTaskDto: CreateTaskDto, user: IUser): Promise<TaskI> {
    const task = await this.taskModel.findOne({
      title: createTaskDto.title,
    });

    if (task) {
      throw new HttpException('TASK_EXISTED', HttpStatus.BAD_REQUEST);
    }

    const newTask = await this.taskModel.create({
      ...createTaskDto,
      author: {
        id: user._id,
        username: user.username,
      },
    });
    return newTask;
  }

  async getTasks(page = 1, limit = 25) {
    const tasks = await this.taskModel
      .find()
      .skip((page - 1) * limit)
      .limit(limit)
      .exec();

    const count = await this.taskModel.countDocuments();
    const pages = Math.ceil(count / limit);

    return {
      currentPage: page,
      pages,
      data: tasks,
    };
  }

  async getTaskById(id: string): Promise<TaskI> {
    const task = await this.taskModel.findById(id);

    if (!task) {
      throw new HttpException('TASK_NOT_FOUND', HttpStatus.NOT_FOUND);
    }

    return task;
  }

  async updateTask(id: string, updateTaskDto: UpdateTaskDto) {
    const task = await this.taskModel.findById(id);

    if (!task) {
      throw new HttpException('TASK_NOT_FOUND', HttpStatus.NOT_FOUND);
    }

    const updatedTask = await this.taskModel.findByIdAndUpdate(
      id,
      updateTaskDto,
      { new: true },
    );

    return updatedTask;
  }

  async auditTask(id: string, updateAuditTaskDto: UpdateAuditTaskDto) {
    const task = await this.taskModel.findById(id);

    if (!task) {
      throw new HttpException('TASK_NOT_FOUND', HttpStatus.NOT_FOUND);
    }

    const updatedTask = await this.taskModel.findByIdAndUpdate(
      id,
      updateAuditTaskDto,
      { new: true },
    );

    return updatedTask;
  }

  async deleteTask(id: string, user: IUser) {
    const task = await this.taskModel.findById(id);
    if (
      task &&
      (user.role === Role.Auditor ||
        (user.role === Role.Staff &&
          task.author.id.toString() === user._id.toString()))
    ) {
      const keys = task.files.map((file) => ({ key: file.key }));
      await this.awsService.deleteFiles(keys);
      await this.taskModel.findByIdAndDelete(id);
      throw new HttpException('TASK_DELETED', HttpStatus.OK);
    }
    throw new HttpException('TASK_NOT_FOUND', HttpStatus.NOT_FOUND);
  }

  async createComment(
    id: string,
    user: IUser,
    createCommentDto: CreateCommentDto,
  ) {
    const task = await this.taskModel.findById(id);

    if (!task) {
      throw new HttpException('TASK_NOT_FOUND', HttpStatus.NOT_FOUND);
    }

    const date = new Date();

    date.setHours(date.getHours() + 7);

    const newComment = {
      ...createCommentDto,
      author: {
        id: user._id,
        username: user.username,
      },
      createdAt: date.toISOString(),
      updatedAt: date.toISOString(),
      id: uuidv4(),
    };

    const updatedTask = await this.taskModel.findByIdAndUpdate(
      id,
      { $push: { comments: newComment } },
      { new: true },
    );

    return updatedTask;
  }

  async deleteComment(id: string, user: IUser, commentId: string) {
    const task = await this.taskModel.findById(id);

    if (!task) {
      throw new HttpException('TASK_NOT_FOUND', HttpStatus.NOT_FOUND);
    }

    const comment = task.comments.find(
      (comment) => comment.id.toString() === commentId,
    );

    if (!comment) {
      throw new HttpException('COMMENT_NOT_FOUND', HttpStatus.NOT_FOUND);
    }

    if (comment.author.id.toString() !== user._id.toString()) {
      throw new HttpException('UNAUTHORIZED', HttpStatus.UNAUTHORIZED);
    }

    const deletedComment = await this.taskModel.findByIdAndUpdate(
      id,
      { $pull: { comments: { id: commentId } } },
      { new: true },
    );

    if (!deletedComment) {
      throw new HttpException('COMMENT_NOT_FOUND', HttpStatus.NOT_FOUND);
    }

    throw new HttpException('TASK_DELETED', HttpStatus.OK);
  }

  async updateComment(
    id: string,
    user: IUser,
    updateCommentDto: UpdateCommentDto,
    commentId: string,
  ) {
    const task = await this.taskModel.findById(id);

    if (!task) {
      throw new HttpException('TASK_NOT_FOUND', HttpStatus.NOT_FOUND);
    }

    const comment = task.comments.find(
      (comment) => comment.id.toString() === commentId,
    );

    if (!comment) {
      throw new HttpException('COMMENT_NOT_FOUND', HttpStatus.NOT_FOUND);
    }

    if (comment.author.id.toString() !== user._id.toString()) {
      throw new HttpException('UNAUTHORIZED', HttpStatus.UNAUTHORIZED);
    }

    const date = new Date();

    date.setHours(date.getHours() + 7);

    const updatedComment = await this.taskModel.findByIdAndUpdate(
      id,
      {
        $set: {
          'comments.$[comment].message': updateCommentDto.message,
          'comments.$[comment].updatedAt': date.toISOString(),
        },
      },
      {
        arrayFilters: [{ 'comment.id': commentId }],
        new: true,
      },
    );

    return updatedComment;
  }
}
